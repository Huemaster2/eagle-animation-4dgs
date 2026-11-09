#include "Arduino.h"
#include <cassert>
#include <iostream>
#include <vector>
unsigned long simMicros = 0;
SerialSim Serial;
int pins[20];
long stepCount = 0, netSteps = 0; int lastStep = 0;
std::vector<int> stepDirs;   // direction of each step (+1 forward)
void pinMode(int, int) {}
void digitalWrite(int pin, int v) {
  if (pin == 2 && v == 1 && lastStep == 0) { int d = pins[5] == 1 ? 1 : -1; stepCount++; netSteps += d; stepDirs.push_back(d); }
  if (pin == 2) lastStep = v;
  pins[pin] = v;
}
#include "../StopMoTurntable/StopMoTurntable.ino"
void send(const char* c) { for (const char* p = c; *p; ++p) Serial.in.push_back(*p); Serial.in.push_back('\n'); }
void runFor(unsigned long ms) { unsigned long end = simMicros + ms * 1000; while (simMicros < end) { loop(); simMicros += 20; } }
bool waitDone(unsigned long maxMs) { unsigned long end = simMicros + maxMs * 1000; while (simMicros < end) { loop(); simMicros += 20; if (Serial.out.find("DONE") != std::string::npos) return true; } return false; }
std::string take() { std::string o = Serial.out; Serial.out.clear(); return o; }
int main() {
  setup(); take();
  send("PING"); runFor(5); assert(take().find("OK PONG") != std::string::npos);
  send("INFO"); runFor(5); std::string info = take(); std::cout << info;
  assert(info.find("steps_per_rev_x1000=3046154") != std::string::npos);  // 200*198/13 = 3046.154

  // Forward absolute move
  stepDirs.clear(); send("MOVETO 160"); assert(waitDone(5000));
  std::string o = take(); assert(o.find("OK MOVETO 160") != std::string::npos && o.find("DONE 160") != std::string::npos);
  assert(netSteps == 160 && stepDirs.back() == 1);
  std::cout << "MOVETO 160 forward: " << stepCount << " steps, POS reports: " << (o.find("POS ") != std::string::npos) << "\n";

  // Backwards target: overshoot by backlash (20) then approach forward
  stepDirs.clear(); long before = stepCount; send("MOVETO 100"); assert(waitDone(5000)); o = take();
  assert(o.find("DONE 100") != std::string::npos && netSteps == 100);
  int back = 0, fwd = 0; for (int d : stepDirs) (d < 0 ? back : fwd)++;
  std::cout << "MOVETO 100 from 160: " << back << " back, " << fwd << " forward, last step dir " << stepDirs.back() << "\n";
  assert(back == 80 && fwd == 20 && stepDirs.back() == 1);

  // Busy protection: second MOVETO while moving is refused
  send("MOVETO 3000"); runFor(30); send("MOVETO 10"); runFor(5); o = take(); assert(o.find("ERR BUSY") != std::string::npos);
  send("STOP"); assert(waitDone(3000)); o = take(); std::cout << "STOP mid-move -> " << o.substr(o.find("DONE")) ;
  long stoppedAt = netSteps; assert(stoppedAt > 100 && stoppedAt < 3000);

  // Jog with watchdog: keep resending for ~600 ms, then stop sending -> must stop by itself
  long jogStart = netSteps; take();
  for (int i = 0; i < 6; i++) { send("JOG 1"); runFor(100); }
  long during = netSteps; assert(during > jogStart);
  send("STOP");
  assert(waitDone(2000)); long after = netSteps; o = take();
  std::cout << "JOG held 600 ms then released (STOP): moved " << during - jogStart << " steps, braked over " << after - during << " more, then " << o.substr(o.find("DONE"));
  assert(after - during <= 12);
  // Watchdog path: app goes silent mid-jog
  long w0 = netSteps; send("JOG -1"); runFor(100); send("JOG -1"); runFor(100);
  long w1 = netSteps; assert(waitDone(2000)); long w2 = netSteps; take();
  std::cout << "JOG watchdog (app silent): coasted " << labs(w2 - w1) << " steps before stopping\n";
  { long s0 = netSteps; runFor(1000); assert(netSteps == s0); }   // fully stopped

  // Interpolation helper check (app side will do this; here just SETPOS)
  send("SETPOS 0"); runFor(5); assert(take().find("OK SETPOS 0") != std::string::npos);
  send("STATUS"); runFor(5); std::cout << take();
  std::cout << "ALL FIRMWARE SIMULATION TESTS PASSED\n";
}
