import { HALF_WIDTH, KERB_WIDTH, nearestIndex, type Track } from "./track";

export const G = 9.81;
export const WHEELBASE = 3.6;
export const CAR_HALF_WIDTH = 1.0;
const GEAR_TOP_KMH = [92, 132, 168, 203, 238, 272, 306, 345];

/** Arcade tuning shared by player and AI so the AI can be planned with the same numbers. */
export const SPEC = {
  latBase: 1.85, // mechanical grip (g)
  latAero: 0.00046, // downforce grip per v² (g / (m/s)²)
  enginePower: 1150, // W/kg-ish: accel = power / v
  maxTraction: 12,
  drag: 0.00128,
  rolling: 0.4,
  brakeBase: 15,
  brakeAero: 0.0019,
};

export const latLimit = (v: number, grip = 1) => G * (SPEC.latBase + SPEC.latAero * v * v) * grip;
export const brakeLimit = (v: number) => SPEC.brakeBase + SPEC.brakeAero * v * v;
export const engineAccel = (v: number) => Math.min(SPEC.maxTraction, SPEC.enginePower / Math.max(v, 1));
export const dragAccel = (v: number) => SPEC.drag * v * v + SPEC.rolling;

export interface CarInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1, positive = left
}

export type Surface = "asphalt" | "kerb" | "grass";

export interface CarState {
  x: number;
  z: number;
  heading: number; // forward = (sin, cos)
  speed: number; // m/s along heading
  steerAngle: number;
  slip: number; // visual oversteer angle
  idx: number; // nearest centerline sample
  lat: number; // lateral offset from centerline, + = left
  s: number; // distance along lap
  surface: Surface;
  gear: number;
  rpm: number;
  wheelSpin: number;
  impact: number; // last wall hit strength (decays)
}

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function createCar(t: Track, s: number, lat: number): CarState {
  const i = ((Math.round(s / t.ds) % t.n) + t.n) % t.n;
  const c: CarState = {
    x: t.px[i] + t.nx[i] * lat,
    z: t.pz[i] + t.nz[i] * lat,
    heading: Math.atan2(t.tx[i], t.tz[i]),
    speed: 0,
    steerAngle: 0,
    slip: 0,
    idx: i,
    lat,
    s: i * t.ds,
    surface: "asphalt",
    gear: 1,
    rpm: 4000,
    wheelSpin: 0,
    impact: 0,
  };
  return c;
}

export function resetToTrack(c: CarState, t: Track) {
  const i = c.idx;
  c.x = t.px[i];
  c.z = t.pz[i];
  c.heading = Math.atan2(t.tx[i], t.tz[i]);
  c.speed = 0;
  c.slip = 0;
  c.lat = 0;
}

export function updateTrackPosition(c: CarState, t: Track, fullSearch = false) {
  const i = nearestIndex(t, c.x, c.z, fullSearch ? -1 : c.idx);
  c.idx = i;
  const dx = c.x - t.px[i];
  const dz = c.z - t.pz[i];
  c.lat = dx * t.nx[i] + dz * t.nz[i];
  const along = dx * t.tx[i] + dz * t.tz[i];
  c.s = (((i * t.ds + along) % t.length) + t.length) % t.length;
}

export function stepCar(c: CarState, inp: CarInput, dt: number, t: Track, frozen = false) {
  const alat = Math.abs(c.lat);
  let grip = 1;
  c.surface = "asphalt";
  if (alat > HALF_WIDTH + KERB_WIDTH) {
    grip = 0.62;
    c.surface = "grass";
  } else if (alat > HALF_WIDTH) {
    grip = 0.96;
    c.surface = "kerb";
  }
  const grass = c.surface === "grass";

  if (frozen) {
    // on the grid: only engine revs
    c.rpm += ((4000 + inp.throttle * 9000) - c.rpm) * Math.min(1, dt * 6);
    c.speed = 0;
    return;
  }

  let v = c.speed;

  // ---- lateral
  const steerMax = 0.42 / (1 + Math.abs(v) / 16);
  c.steerAngle = inp.steer * steerMax;
  let yaw = (v * Math.tan(c.steerAngle)) / WHEELBASE;
  const yawMax = latLimit(Math.abs(v), grip) / Math.max(Math.abs(v), 1);
  let scrub = 0;
  let excess = 0;
  if (Math.abs(yaw) > yawMax) {
    excess = Math.abs(yaw) - yawMax;
    scrub = Math.min(8, excess * Math.abs(v) * 0.1);
    yaw = Math.sign(yaw) * yawMax;
  }
  c.slip += (Math.sign(yaw) * Math.min(0.12, excess * 0.25) - c.slip) * Math.min(1, dt * 5);
  c.heading = wrapAngle(c.heading + yaw * dt);

  // ---- longitudinal
  const av = Math.abs(v);
  if (v >= -0.5) {
    const engine = inp.throttle * engineAccel(av) * (grass ? 0.65 : 1);
    const drag = dragAccel(av) + (grass ? 3 + 0.004 * av * av : 0);
    v += (engine - drag - scrub) * dt;
    if (inp.brake > 0) {
      if (v > 0.3) v = Math.max(0, v - inp.brake * brakeLimit(av) * (grass ? 0.55 : 1) * dt);
      else if (inp.throttle < 0.1) v -= inp.brake * 5 * dt; // reverse
    }
    if (v < 0 && inp.brake === 0) v = Math.min(0, v + 4 * dt);
  } else {
    // reversing
    v += (inp.throttle * 15 + 2) * dt;
    v -= inp.brake * 5 * dt;
    v = Math.max(v, -9);
  }
  c.speed = v;

  // ---- integrate
  c.x += Math.sin(c.heading) * v * dt;
  c.z += Math.cos(c.heading) * v * dt;
  updateTrackPosition(c, t);

  // ---- barriers
  const limL = t.wallL[c.idx] - CAR_HALF_WIDTH;
  const limR = t.wallR[c.idx] - CAR_HALF_WIDTH;
  if (c.lat > limL || c.lat < -limR) {
    const target = c.lat > limL ? limL : -limR;
    const over = c.lat - target;
    c.x -= t.nx[c.idx] * over;
    c.z -= t.nz[c.idx] * over;
    c.lat = target;
    const th = Math.atan2(t.tx[c.idx], t.tz[c.idx]);
    const rel = wrapAngle(c.heading - th);
    const impact = Math.abs(Math.sin(rel));
    c.impact = Math.max(c.impact, impact * Math.abs(c.speed));
    c.speed *= Math.max(0.15, 1 - 0.75 * impact) * 0.985;
    if (Math.abs(rel) < Math.PI / 2) c.heading = wrapAngle(th + rel * 0.35);
    else c.heading = wrapAngle(th + Math.PI + wrapAngle(rel - Math.PI) * 0.35);
  }
  c.impact *= Math.exp(-dt * 4);

  // ---- drivetrain (display / sound)
  const kmh = Math.abs(c.speed) * 3.6;
  let gear = 1;
  while (gear < 8 && kmh > GEAR_TOP_KMH[gear - 1] * 0.96) gear++;
  c.gear = c.speed < -0.3 ? 0 : gear;
  const lo = gear > 1 ? GEAR_TOP_KMH[gear - 2] * 0.96 : 0;
  const hi = GEAR_TOP_KMH[gear - 1];
  const targetRpm = 6500 + 8500 * Math.min(1, Math.max(0, (kmh - lo * 0.6) / (hi - lo * 0.6)));
  c.rpm += (targetRpm - c.rpm) * Math.min(1, dt * 12);
  c.wheelSpin += (c.speed / 0.36) * dt;
}

/** Push overlapping cars apart (two circles per car along its axis). */
export function collideCars(cars: CarState[]) {
  const r = 1.05;
  const off = 1.45;
  for (let a = 0; a < cars.length; a++) {
    for (let b = a + 1; b < cars.length; b++) {
      const A = cars[a];
      const B = cars[b];
      const ddx = B.x - A.x;
      const ddz = B.z - A.z;
      if (ddx * ddx + ddz * ddz > 49) continue;
      for (const sa of [off, -off]) {
        for (const sb of [off, -off]) {
          const ax = A.x + Math.sin(A.heading) * sa;
          const az = A.z + Math.cos(A.heading) * sa;
          const bx = B.x + Math.sin(B.heading) * sb;
          const bz = B.z + Math.cos(B.heading) * sb;
          const dx = bx - ax;
          const dz = bz - az;
          const d = Math.hypot(dx, dz);
          if (d >= 2 * r || d < 1e-4) continue;
          const nx = dx / d;
          const nz = dz / d;
          const push = (2 * r - d) / 2;
          A.x -= nx * push;
          A.z -= nz * push;
          B.x += nx * push;
          B.z += nz * push;
          // velocity exchange along the contact normal
          const avx = Math.sin(A.heading) * A.speed;
          const avz = Math.cos(A.heading) * A.speed;
          const bvx = Math.sin(B.heading) * B.speed;
          const bvz = Math.cos(B.heading) * B.speed;
          const rel = (avx - bvx) * nx + (avz - bvz) * nz;
          if (rel > 0) {
            const j = rel * 0.75; // (1+e)/2 with e≈0.5
            const nav = { x: avx - nx * j, z: avz - nz * j };
            const nbv = { x: bvx + nx * j, z: bvz + nz * j };
            A.speed = nav.x * Math.sin(A.heading) + nav.z * Math.cos(A.heading);
            B.speed = nbv.x * Math.sin(B.heading) + nbv.z * Math.cos(B.heading);
            const hit = Math.abs(rel);
            A.impact = Math.max(A.impact, hit);
            B.impact = Math.max(B.impact, hit);
          }
        }
      }
    }
  }
}
