// A stand-in for the rig, for working on the app with no camera and no turntable on the bench.
// The simulated board speaks the same serial lines as the firmware, and the simulated camera draws the
// set as the table stands, so turning it really does change the picture.

const STEPS_PER_REV_X1000 = 3046154;
const TICK_MS = 5;
const JOG_TIMEOUT_MS = 250;
const JOG_CHUNK = 62;

const listeners = new Set();

// What the simulated camera draws: the pose the puppet is in and where the camera is standing
export const simRig = {
  pose: 0.35,
  cameraHeight: 1,
  shots: 0,
  set(patch) {
    Object.assign(simRig, patch);
    for (const fn of listeners) fn(simRig);
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// ---------------------------------------------------------------- the board

// A serial port that behaves like the Arduino: the app's own turntable code talks to it unchanged
export const createSimulatedPort = () => {
  let position = 0;
  let target = 0;
  let segment = 0;
  let finalLeg = false;
  let moving = false;
  let jogging = false;
  let jogDir = 0;
  let lastJog = 0;
  let enabled = false;
  let backlash = 20;
  let runUs = 950;
  let startUs = 1500;
  let ramp = 12;
  let controller = null;
  let timer = null;
  let broadcast = null;

  const send = (line) => controller?.enqueue(new TextEncoder().encode(`${line}\r\n`));
  const stepsPerTick = () => Math.max(1, Math.round(9500 / Math.max(200, runUs)));

  const begin = (to, forwards) => {
    target = to;
    // A MOVETO always ends going forwards: it stops short and comes back up to the target
    finalLeg = forwards && to < position && backlash > 0;
    segment = finalLeg ? to - backlash : to;
    moving = true;
  };

  const tick = () => {
    if (jogging) {
      if (Date.now() - lastJog > JOG_TIMEOUT_MS) {
        segment = position + Math.sign(segment - position) * Math.min(12, Math.abs(segment - position));
        target = segment;
        finalLeg = false;
        jogging = false;
      } else {
        const ahead = position + jogDir * JOG_CHUNK;
        if ((jogDir > 0 && segment < ahead) || (jogDir < 0 && segment > ahead)) {
          segment = ahead;
          target = ahead;
        }
      }
    }
    if (!moving) return;
    for (let i = 0; i < stepsPerTick(); i++) {
      if (position === segment) {
        if (finalLeg) {
          finalLeg = false;
          segment = target;
          return;
        }
        moving = false;
        jogging = false;
        send(`DONE ${position}`);
        return;
      }
      position += segment > position ? 1 : -1;
    }
  };

  const handle = (text) => {
    const [name, ...rest] = text.trim().split(' ');
    const arg = rest.join(' ');
    const key = (name || '').toUpperCase();
    if (!key) return;
    if (key === 'PING') return send('OK PONG StopMoTurntable 2');
    if (key === 'INFO')
      return send(`INFO fw=2 microsteps=1 steps_per_rev_x1000=${STEPS_PER_REV_X1000} pos=${position} backlash=${backlash} run_us=${runUs} start_us=${startUs} ramp=${ramp} enabled=${enabled ? 1 : 0}`);
    if (key === 'STOP') {
      send('OK STOP');
      if (!moving) return send(`DONE ${position}`);
      segment = position + Math.sign(segment - position) * Math.min(12, Math.abs(segment - position));
      target = segment;
      finalLeg = false;
      jogging = false;
      return undefined;
    }
    if (key === 'JOG') {
      const dir = Number(arg) >= 0 ? 1 : -1;
      if (moving && !jogging) return send('ERR BUSY');
      lastJog = Date.now();
      if (!jogging) {
        jogging = true;
        jogDir = dir;
        begin(position + dir * JOG_CHUNK, false);
        send(`OK JOG ${dir}`);
      }
      return undefined;
    }
    if (key === 'MOVETO' || key === 'MOVE') {
      if (moving) return send('ERR BUSY');
      const value = Math.round(Number(arg) || 0);
      send(`OK ${key} ${value}`);
      return begin(key === 'MOVETO' ? value : position + value, key === 'MOVETO');
    }
    if (key === 'SETPOS') {
      if (moving) return send('ERR BUSY');
      position = Math.round(Number(arg) || 0);
      target = position;
      return send(`OK SETPOS ${position}`);
    }
    if (key === 'BACKLASH') {
      backlash = Math.max(0, Math.round(Number(arg) || 0));
      return send(`OK BACKLASH ${backlash}`);
    }
    if (key === 'SPEED') {
      const [a, b, c] = arg.split(' ').map(Number);
      if (a) runUs = a;
      if (b) startUs = b;
      if (Number.isFinite(c)) ramp = c;
      return send(`OK SPEED ${runUs} ${startUs} ${ramp}`);
    }
    if (key === 'ENABLE') {
      if (moving) return send('ERR BUSY');
      enabled = Number(arg) !== 0;
      return send(`OK ENABLE ${enabled ? 1 : 0}`);
    }
    return send(`ERR UNKNOWN ${key}`);
  };

  return {
    simulated: true,
    // Where the table stands, for the simulated camera to draw
    get position() {
      return position;
    },
    getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
    async open() {
      timer = setInterval(tick, TICK_MS);
      broadcast = setInterval(() => moving && send(`POS ${position}`), 100);
      // The board reboots when the port opens, twice on the clones this rig uses
      setTimeout(() => send('READY StopMoTurntable 2'), 250);
      setTimeout(() => send('READY StopMoTurntable 2'), 800);
    },
    readable: new ReadableStream({
      start(c) {
        controller = c;
      },
    }),
    writable: new WritableStream({
      write(chunk) {
        for (const line of new TextDecoder().decode(chunk).split('\n')) if (line.trim()) handle(line);
      },
    }),
    async close() {
      clearInterval(timer);
      clearInterval(broadcast);
      controller = null;
    },
  };
};

// ---------------------------------------------------------------- the set

const DISTANCE = 820;
const FOCAL = 1500;

// Table space: x right, y away from the camera, z up. The camera looks down on the table from the front.
const project = (x, y, z, elevation, width, height) => {
  const e = (elevation * Math.PI) / 180;
  const depth = y * Math.cos(e) + z * Math.sin(e) + DISTANCE;
  const up = -y * Math.sin(e) + z * Math.cos(e);
  const scale = (FOCAL * height) / 854;
  return { x: width / 2 + (scale * x) / depth, y: height * 0.62 - (scale * up) / depth, depth, scale: scale / depth };
};

const turned = (x, y, angle) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];

const POSTS = [
  { at: 0, radius: 210, tall: 150, color: '#d8d8d8', name: '1' },
  { at: 120, radius: 210, tall: 110, color: '#9a9a9a', name: '2' },
  { at: 240, radius: 210, tall: 130, color: '#6d6d6d', name: '3' },
];

// Draws the set as it looks from the camera: a turntable with a puppet and three marker posts.
// The angle comes from the simulated board, so a turn of the table turns the picture.
export const drawSimulatedSet = (ctx, width, height, { angle = 0, pose = 0.35, cameraHeight = 1, caption = '' } = {}) => {
  const elevation = 8 + (cameraHeight - 1) * 14;
  const to = (x, y, z) => project(x, y, z, elevation, width, height);

  ctx.fillStyle = '#121212';
  ctx.fillRect(0, 0, width, height);

  // The table top
  ctx.beginPath();
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const p = to(Math.cos(a) * 300, Math.sin(a) * 300, 0);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = '#e8e8e4';
  ctx.fill();

  // A wedge painted on the table, so the angle is readable even without the posts
  ctx.beginPath();
  const centre = to(0, 0, 0);
  ctx.moveTo(centre.x, centre.y);
  for (let i = 0; i <= 12; i++) {
    const a = angle - 0.12 + (i / 12) * 0.24;
    const p = to(Math.cos(a) * 300, Math.sin(a) * 300, 0);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = '#b9b9b2';
  ctx.fill();

  const items = [];
  for (const post of POSTS) {
    const a = angle + (post.at * Math.PI) / 180;
    const [x, y] = turned(post.radius, 0, a);
    items.push({
      depth: to(x, y, 0).depth,
      draw: () => {
        const base = to(x, y, 0);
        const top = to(x, y, post.tall);
        ctx.strokeStyle = post.color;
        ctx.lineWidth = Math.max(2, 16 * base.scale);
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(top.x, top.y);
        ctx.stroke();
        ctx.fillStyle = post.color;
        ctx.beginPath();
        ctx.arc(top.x, top.y, Math.max(3, 18 * top.scale), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#121212';
        ctx.font = `${Math.max(8, Math.round(22 * top.scale))}px 'Open Sans', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(post.name, top.x, top.y);
      },
    });
  }

  // The puppet: a body, a head, a snout that shows which way it faces, and arms that move with the pose
  items.push({
    depth: to(0, 0, 0).depth - 1,
    draw: () => {
      const hip = to(0, 0, 40);
      const neck = to(0, 0, 190);
      const head = to(0, 0, 235);
      ctx.strokeStyle = '#2f2f2f';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(4, 44 * hip.scale);
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(neck.x, neck.y);
      ctx.stroke();
      const swing = (pose - 0.5) * 2;
      for (const side of [-1, 1]) {
        const [hx, hy] = turned(side * 70, swing * 90, angle);
        const hand = to(hx, hy, 150 + swing * 60 * side);
        ctx.lineWidth = Math.max(2, 18 * hip.scale);
        ctx.beginPath();
        ctx.moveTo(neck.x, neck.y);
        ctx.lineTo(hand.x, hand.y);
        ctx.stroke();
      }
      ctx.fillStyle = '#3a3a3a';
      ctx.beginPath();
      ctx.arc(head.x, head.y, Math.max(5, 46 * head.scale), 0, Math.PI * 2);
      ctx.fill();
      const [sx, sy] = turned(0, -70, angle);
      const snout = to(sx, sy, 230);
      ctx.strokeStyle = '#f0c040';
      ctx.lineWidth = Math.max(2, 14 * head.scale);
      ctx.beginPath();
      ctx.moveTo(head.x, head.y);
      ctx.lineTo(snout.x, snout.y);
      ctx.stroke();
    },
  });

  for (const item of items.sort((a, b) => b.depth - a.depth)) item.draw();

  const degrees = ((((angle * 180) / Math.PI) % 360) + 360) % 360;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, width, Math.round(height * 0.06));
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(height * 0.028)}px 'Open Sans', sans-serif`;
  ctx.fillText(
    `SIMULATED RIG · table ${degrees.toFixed(1)}° · camera height ${cameraHeight} · pose ${Math.round(pose * 100)}%${caption ? ` · ${caption}` : ''}`,
    Math.round(width * 0.02),
    Math.round(height * 0.03)
  );
};
