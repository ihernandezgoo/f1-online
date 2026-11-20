import { brakeLimit, dragAccel, G, SPEC, WHEELBASE, wrapAngle, type CarInput, type CarState } from "./physics";
import { HALF_WIDTH, type Track } from "./track";

export interface RacingLine {
  off: Float64Array; // lateral offset of the line from the centerline
  x: Float64Array;
  z: Float64Array;
  speed: Float64Array; // max speed profile (m/s)
}

const VMAX = 96;

/** Elastic-band smoothing gives a reasonable minimum-curvature line; then a speed profile with braking zones. */
export function buildRacingLine(t: Track): RacingLine {
  const n = t.n;
  const off = new Float64Array(n);
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const margin = HALF_WIDTH - 1.7;
  const place = () => {
    for (let i = 0; i < n; i++) {
      x[i] = t.px[i] + t.nx[i] * off[i];
      z[i] = t.pz[i] + t.nz[i] * off[i];
    }
  };
  place();
  for (const m of [24, 14, 8, 4]) {
    for (let it = 0; it < 40; it++) {
      for (let i = 0; i < n; i++) {
        const a = (i - m + n) % n;
        const b = (i + m) % n;
        const mx = (x[a] + x[b]) / 2;
        const mz = (z[a] + z[b]) / 2;
        let o = (mx - t.px[i]) * t.nx[i] + (mz - t.pz[i]) * t.nz[i];
        o = Math.max(-margin, Math.min(margin, o));
        off[i] = off[i] * 0.5 + o * 0.5;
        x[i] = t.px[i] + t.nx[i] * off[i];
        z[i] = t.pz[i] + t.nz[i] * off[i];
      }
    }
  }
  place();

  // curvature of the racing line
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 3 + n) % n;
    const b = (i + 3) % n;
    const h1 = Math.atan2(x[i] - x[a], z[i] - z[a]);
    const h2 = Math.atan2(x[b] - x[i], z[b] - z[i]);
    const d = Math.hypot(x[b] - x[a], z[b] - z[a]) / 2 || 1;
    k[i] = Math.abs(wrapAngle(h2 - h1)) / d;
  }

  const speed = new Float64Array(n);
  const aeroK = G * SPEC.latAero;
  for (let i = 0; i < n; i++) {
    const kk = k[i];
    speed[i] = kk <= aeroK + 1e-5 ? VMAX : Math.min(VMAX, Math.sqrt((G * SPEC.latBase) / (kk - aeroK)));
  }
  // backward pass: braking zones (twice around for the wrap)
  for (let pass = 0; pass < 2; pass++) {
    for (let s = n - 1; s >= 0; s--) {
      const i = s;
      const nxt = speed[(i + 1) % n];
      const dec = brakeLimit(nxt) * 0.8 + dragAccel(nxt);
      speed[i] = Math.min(speed[i], Math.sqrt(nxt * nxt + 2 * dec * t.ds));
    }
  }
  return { off, x, z, speed };
}

export interface AiDriver {
  skill: number; // fraction of the theoretical speed profile
  laneBias: number; // personal lateral offset
  stuckTime: number;
}

export function aiControl(c: CarState, ai: AiDriver, t: Track, rl: RacingLine, others: CarState[], dt: number): CarInput {
  const n = t.n;
  const v = Math.max(0, c.speed);
  const look = Math.min(42, Math.max(9, 7 + v * 0.42));
  const j = (c.idx + Math.round(look / t.ds)) % n;

  // simple overtaking: dodge a car right in front
  let dodge = 0;
  for (const o of others) {
    if (o === c) continue;
    let ahead = o.s - c.s;
    if (ahead < -t.length / 2) ahead += t.length;
    if (ahead > t.length / 2) ahead -= t.length;
    if (ahead > 0 && ahead < 22 && Math.abs(o.lat - c.lat) < 2.6 && o.speed < c.speed + 3) {
      dodge = o.lat > rl.off[c.idx] ? -3.2 : 3.2;
    }
  }
  const lateral = Math.max(-HALF_WIDTH + 1.4, Math.min(HALF_WIDTH - 1.4, rl.off[j] + ai.laneBias + dodge));
  const tx = t.px[j] + t.nx[j] * lateral;
  const tz = t.pz[j] + t.nz[j] * lateral;
  const ang = wrapAngle(Math.atan2(tx - c.x, tz - c.z) - c.heading);
  const dist = Math.hypot(tx - c.x, tz - c.z) || 1;
  // pure pursuit
  const curv = (2 * Math.sin(ang)) / dist;
  const wantAngle = Math.atan(curv * WHEELBASE);
  const steerMax = 0.42 / (1 + v / 16);
  const steer = Math.max(-1, Math.min(1, wantAngle / steerMax));

  const ahead = (c.idx + Math.round((v * 0.25) / t.ds)) % n;
  const target = Math.min(rl.speed[ahead], rl.speed[c.idx]) * ai.skill * (dodge ? 0.98 : 1);
  let throttle = 0;
  let brake = 0;
  if (v < target - 0.5) throttle = 1;
  else if (v > target + 1.5) brake = Math.min(1, (v - target) / 6);
  else throttle = 0.4;
  if (c.surface === "grass") throttle = Math.min(throttle, 0.7);

  if (v < 2) ai.stuckTime += dt;
  else ai.stuckTime = 0;
  return { throttle, brake, steer };
}
