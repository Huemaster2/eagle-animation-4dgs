/*
  StopMo turntable firmware
  -------------------------
  Controlled from the StopMo app over USB serial (115200 baud, one command per line).
  Replaces the fixed 25-shot sketch: the app decides positions, the Arduino only moves.

  Same hardware and gearing as turntable_25_shots:
  - Arduino Uno + CNC Shield V3, A4988 in the X socket, stepper on X
  - Internal ring gear 198 teeth, motor pinion 13 teeth (15.230769:1)
  - 4N25 camera trigger on SpnEn (pin 12), kept for an optional hardware shutter

  Positions are absolute motor steps (microsteps). The app stores calibrations
  (FRONT/RIGHT/BACK/LEFT, capture start/end) as step counts.

  Backlash: every MOVETO finishes travelling FORWARD (the same direction as the
  capture sequence), so the 198:13 gears are always loaded the same way at rest.
  A backwards target is overshot by BACKLASH steps and then approached forwards.

  Commands (reply on one line each)
    PING                      -> OK PONG StopMoTurntable 2
    INFO                      -> INFO fw=2 microsteps=.. steps_per_rev_x1000=.. pos=.. backlash=.. run_us=.. start_us=.. ramp=.. enabled=..
    STATUS                    -> STATUS pos=<p> target=<t> moving=<0|1> enabled=<0|1>
    MOVETO <steps>            -> OK MOVETO <steps>      ...later: DONE <pos>
    MOVE <delta>              -> OK MOVE <delta>        ...later: DONE <pos>   (raw relative move, no backlash approach)
    JOG <+1|-1>               -> OK JOG <dir>           keeps turning while JOG is resent at least every 400 ms
    STOP                      -> OK STOP                ...later: DONE <pos>
    SETPOS <steps>            -> OK SETPOS <steps>      define the current position (no movement)
    BACKLASH <steps>          -> OK BACKLASH <steps>
    SPEED <run_us> <start_us> <ramp_steps> -> OK SPEED ...
    ENABLE <0|1>              -> OK ENABLE <0|1>
    SHUTTER <ms>              -> OK SHUTTER <ms>        hardware trigger; the app never sends this unless asked
  While moving: POS <p> every 100 ms.  Errors: ERR <reason>.
  A new MOVETO/MOVE/JOG while a move is running is refused with ERR BUSY (no conflicting commands).
*/

// ---------------- Pins ----------------
const byte STEP_PIN   = 2;   // X STEP
const byte DIR_PIN    = 5;   // X DIR
const byte ENABLE_PIN = 8;   // active LOW
const byte CAMERA_PIN = 12;  // SpnEn -> 4N25

// ---------------- Mechanics ----------------
const long MOTOR_FULL_STEPS  = 200;
const int  MICROSTEPS        = 1;   // match the A4988 jumpers
const long RING_GEAR_TEETH   = 198;
const long PINION_GEAR_TEETH = 13;
const byte FORWARD_DIR       = HIGH; // same as ROTATION_DIRECTION in the old sketch

// ---------------- Motion settings (changeable with SPEED / BACKLASH) ----------------
unsigned int runDelayUs   = 950;
unsigned int startDelayUs = 1500;
long rampSteps            = 12;
long backlashSteps        = 20;

// ---------------- State ----------------
long position = 0;          // current absolute position in steps
long target = 0;            // final target of the current command
long segmentTarget = 0;     // current leg (overshoot leg, then final leg)
bool finalLegPending = false;
bool moving = false;
bool jogging = false;
int  jogDir = 0;
unsigned long lastJogMs = 0;
bool stopRequested = false;
bool enabled = false;

long legStart = 0;          // position where the current leg began
unsigned long nextStepUs = 0;
bool stepPinHigh = false;
unsigned long lastPosReportMs = 0;

String line;

// ---------------- Helpers ----------------
long stepsPerRevX1000() {
  return (MOTOR_FULL_STEPS * MICROSTEPS * RING_GEAR_TEETH * 1000L + PINION_GEAR_TEETH / 2) / PINION_GEAR_TEETH;
}

void setEnabled(bool on) {
  enabled = on;
  digitalWrite(ENABLE_PIN, on ? LOW : HIGH);
}

void reportDone() {
  Serial.print(F("DONE "));
  Serial.println(position);
}

void startLeg(long to) {
  segmentTarget = to;
  legStart = position;
  if (segmentTarget == position) return;
  digitalWrite(DIR_PIN, segmentTarget > position ? FORWARD_DIR : !FORWARD_DIR);
  delayMicroseconds(5);
  nextStepUs = micros();
  stepPinHigh = false;
}

void beginMoveTo(long to, bool approachForward) {
  if (!enabled) { setEnabled(true); delay(50); }
  target = to;
  stopRequested = false;
  // Backwards targets: overshoot past the target, then come back forwards.
  if (approachForward && to < position && backlashSteps > 0) {
    finalLegPending = true;
    startLeg(to - backlashSteps);
  } else {
    finalLegPending = false;
    startLeg(to);
  }
  moving = true;
}

// Trapezoid: accelerate from startDelayUs to runDelayUs over rampSteps, mirror at the end.
unsigned int currentDelay() {
  long done = labs(position - legStart);
  long total = labs(segmentTarget - legStart);
  long remaining = total - done;
  long ramp = rampSteps;
  if (total < ramp * 2) ramp = total / 2;
  long k = done < remaining ? done : remaining;
  if (ramp > 0 && k < ramp) {
    return startDelayUs - (unsigned int)(((long)(startDelayUs - runDelayUs) * k) / ramp);
  }
  return runDelayUs;
}

void serviceMotion() {
  if (!moving) return;
  unsigned long now = micros();
  if ((long)(now - nextStepUs) < 0) return;

  if (!stepPinHigh) {
    if (position == segmentTarget || (stopRequested && !jogging)) {
      // Leg finished (or stop requested): start the final forward leg if one is pending.
      if (!stopRequested && finalLegPending) {
        finalLegPending = false;
        startLeg(target);
        return;
      }
      moving = false;
      jogging = false;
      stopRequested = false;
      reportDone();
      return;
    }
    digitalWrite(STEP_PIN, HIGH);
    stepPinHigh = true;
    nextStepUs = now + currentDelay();
  } else {
    digitalWrite(STEP_PIN, LOW);
    stepPinHigh = false;
    position += (segmentTarget > position) ? 1 : -1;
    nextStepUs = now + currentDelay();
  }
}

void serviceJog() {
  if (!jogging) return;
  // Watchdog: if the app stops resending JOG (button released, app crashed), stop.
  if (millis() - lastJogMs > 400) {
    jogging = false;
    // Finish with a short decelerating leg
    segmentTarget = position + (jogDir > 0 ? rampSteps : -rampSteps);
    legStart = segmentTarget - (jogDir > 0 ? 2 * rampSteps : -2 * rampSteps);
    target = segmentTarget;
    finalLegPending = false;
    return;
  }
  // Keep the jog leg running ahead of the current position
  long ahead = position + jogDir * (rampSteps + 50);
  if ((jogDir > 0 && segmentTarget < ahead) || (jogDir < 0 && segmentTarget > ahead)) {
    segmentTarget = ahead;
    target = ahead;
  }
}

void fireShutter(unsigned long ms) {
  digitalWrite(CAMERA_PIN, HIGH);
  delay(ms);
  digitalWrite(CAMERA_PIN, LOW);
}

// ---------------- Commands ----------------
void handleLine(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;
  String upper = cmd;
  upper.toUpperCase();
  int sp = upper.indexOf(' ');
  String name = sp < 0 ? upper : upper.substring(0, sp);
  String arg = sp < 0 ? "" : cmd.substring(sp + 1);
  arg.trim();

  if (name == "PING") {
    Serial.println(F("OK PONG StopMoTurntable 2"));
  } else if (name == "INFO") {
    Serial.print(F("INFO fw=2 microsteps=")); Serial.print(MICROSTEPS);
    Serial.print(F(" steps_per_rev_x1000=")); Serial.print(stepsPerRevX1000());
    Serial.print(F(" pos=")); Serial.print(position);
    Serial.print(F(" backlash=")); Serial.print(backlashSteps);
    Serial.print(F(" run_us=")); Serial.print(runDelayUs);
    Serial.print(F(" start_us=")); Serial.print(startDelayUs);
    Serial.print(F(" ramp=")); Serial.print(rampSteps);
    Serial.print(F(" enabled=")); Serial.println(enabled ? 1 : 0);
  } else if (name == "STATUS") {
    Serial.print(F("STATUS pos=")); Serial.print(position);
    Serial.print(F(" target=")); Serial.print(target);
    Serial.print(F(" moving=")); Serial.print(moving ? 1 : 0);
    Serial.print(F(" enabled=")); Serial.println(enabled ? 1 : 0);
  } else if (name == "STOP") {
    Serial.println(F("OK STOP"));
    if (moving) {
      stopRequested = true;
      jogging = false;
      finalLegPending = false;
    } else {
      reportDone();
    }
  } else if (name == "JOG") {
    int dir = arg.toInt() >= 0 ? 1 : -1;
    if (moving && !jogging) { Serial.println(F("ERR BUSY")); return; }
    if (jogging && dir != jogDir) { Serial.println(F("ERR BUSY")); return; }
    lastJogMs = millis();
    if (!jogging) {
      jogging = true;
      jogDir = dir;
      beginMoveTo(position + dir * (rampSteps + 50), false);
      Serial.print(F("OK JOG ")); Serial.println(dir);
    }
  } else if (name == "MOVETO" || name == "MOVE") {
    if (moving) { Serial.println(F("ERR BUSY")); return; }
    long v = arg.toInt();
    if (arg.length() == 0) { Serial.println(F("ERR ARG")); return; }
    Serial.print(F("OK ")); Serial.print(name); Serial.print(' '); Serial.println(v);
    if (name == "MOVETO") beginMoveTo(v, true);
    else beginMoveTo(position + v, false);
    if (!moving) reportDone();
  } else if (name == "SETPOS") {
    if (moving) { Serial.println(F("ERR BUSY")); return; }
    position = arg.toInt();
    target = position;
    Serial.print(F("OK SETPOS ")); Serial.println(position);
  } else if (name == "BACKLASH") {
    backlashSteps = max(0L, arg.toInt());
    Serial.print(F("OK BACKLASH ")); Serial.println(backlashSteps);
  } else if (name == "SPEED") {
    if (moving) { Serial.println(F("ERR BUSY")); return; }
    long a = 0, b = 0, c = 0;
    int s1 = arg.indexOf(' ');
    int s2 = s1 < 0 ? -1 : arg.indexOf(' ', s1 + 1);
    if (s1 < 0 || s2 < 0) { Serial.println(F("ERR ARG")); return; }
    a = arg.substring(0, s1).toInt();
    b = arg.substring(s1 + 1, s2).toInt();
    c = arg.substring(s2 + 1).toInt();
    if (a < 200 || b < a || c < 0) { Serial.println(F("ERR ARG")); return; }
    runDelayUs = a; startDelayUs = b; rampSteps = c;
    Serial.print(F("OK SPEED ")); Serial.print(runDelayUs); Serial.print(' ');
    Serial.print(startDelayUs); Serial.print(' '); Serial.println(rampSteps);
  } else if (name == "ENABLE") {
    if (moving) { Serial.println(F("ERR BUSY")); return; }
    setEnabled(arg.toInt() != 0);
    Serial.print(F("OK ENABLE ")); Serial.println(enabled ? 1 : 0);
  } else if (name == "SHUTTER") {
    if (moving) { Serial.println(F("ERR BUSY")); return; }
    unsigned long ms = arg.length() ? (unsigned long)arg.toInt() : 250;
    Serial.print(F("OK SHUTTER ")); Serial.println(ms);
    fireShutter(ms);
  } else {
    Serial.print(F("ERR UNKNOWN ")); Serial.println(name);
  }
}

void readSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (line.length()) handleLine(line);
      line = "";
    } else if (line.length() < 48) {
      line += c;
    }
  }
}

void setup() {
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);
  pinMode(ENABLE_PIN, OUTPUT);
  pinMode(CAMERA_PIN, OUTPUT);
  digitalWrite(STEP_PIN, LOW);
  digitalWrite(DIR_PIN, FORWARD_DIR);
  digitalWrite(CAMERA_PIN, LOW);
  setEnabled(false);
  Serial.begin(115200);
  line.reserve(48);
  Serial.println(F("READY StopMoTurntable 2"));
}

void loop() {
  readSerial();
  serviceJog();
  serviceMotion();
  if (moving && millis() - lastPosReportMs >= 100) {
    lastPosReportMs = millis();
    Serial.print(F("POS ")); Serial.println(position);
  }
}
