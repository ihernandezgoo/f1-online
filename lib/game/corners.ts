import { brakeLimit, G, SPEC } from "./physics";
import type { Track } from "./track";

export interface Corner {
  number: number;
  start: number; // centerline index where the corner begins
  end: number;
  dir: 1 | -1; // 1 = left, -1 = right
  minRadius: number;
  vMax: number; // rough max speed through it (m/s)
  grade: number; // 1 = hairpin … 6 = flat out kink
}

const VMAX = 96;

export function cornerSpeed(radius: number): number {
  const k = 1 / radius;
  const aero = G * SPEC.latAero;
  return k <= aero ? VMAX : Math.min(VMAX, Math.sqrt((G * SPEC.latBase) / (k - aero)));
}

function grade(r: number): number {
  if (r < 30) return 1;
  if (r < 55) return 2;
  if (r < 90) return 3;
  if (r < 140) return 4;
  if (r < 220) return 5;
  return 6;
}

/** Groups high-curvature stretches into corners (numbered from the start line). */
export function detectCorners(t: Track): Corner[] {
  const n = t.n;
  const on = (i: number) => Math.abs(t.k[i]) > 1 / 260;
  // start scanning on a straight so corners don't get split across the wrap
  let s0 = 0;
  while (s0 < n && on(s0)) s0++;
  const corners: Corner[] = [];
  let i = 0;
  while (i < n) {
    const idx = (s0 + i) % n;
    if (!on(idx)) {
      i++;
      continue;
    }
    const start = idx;
    let minR = Infinity;
    let signSum = 0;
    let gap = 0;
    let last = idx;
    while (i < n && gap < 8) {
      const j = (s0 + i) % n;
      if (on(j)) {
        const sameDir = signSum === 0 || Math.sign(t.k[j]) === Math.sign(signSum);
        if (!sameDir && gap === 0 && 1 / Math.abs(t.k[j]) < 200) break; // chicane: split
        minR = Math.min(minR, 1 / Math.abs(t.k[j]));
        signSum += t.k[j];
        last = j;
        gap = 0;
      } else gap++;
      i++;
    }
    const lenIdx = (last - start + n) % n;
    // skip short wiggles and bends taken flat out
    if (lenIdx * t.ds > 12 && minR < 260 && cornerSpeed(minR) < VMAX * 0.97) {
      corners.push({
        number: corners.length + 1,
        start,
        end: last,
        dir: signSum > 0 ? 1 : -1,
        minRadius: minR,
        vMax: cornerSpeed(minR),
        grade: grade(minR),
      });
    }
  }
  corners.sort((a, b) => a.start - b.start);
  corners.forEach((c, k) => (c.number = k + 1));
  return corners;
}

export interface CornerInfo {
  number: number;
  dir: 1 | -1;
  grade: number;
  distance: number; // metres to the corner entry (0 = inside)
  brake: boolean;
}

/** Next corner ahead of the car and whether it should already be braking. */
export function nextCorner(t: Track, corners: Corner[], idx: number, speed: number): CornerInfo | null {
  if (!corners.length) return null;
  const n = t.n;
  let best: Corner | null = null;
  let bestD = Infinity;
  for (const c of corners) {
    const inside = (idx - c.start + n) % n <= (c.end - c.start + n) % n;
    const d = inside ? 0 : ((c.start - idx + n) % n) * t.ds;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (!best || bestD > 450) return null;
  const v = Math.max(0, speed);
  const vc = best.vMax * 0.95;
  const decel = brakeLimit((v + vc) / 2) * 0.8;
  const brakeDist = v > vc ? (v * v - vc * vc) / (2 * decel) : 0;
  return {
    number: best.number,
    dir: best.dir,
    grade: best.grade,
    distance: Math.round(bestD),
    brake: v > vc + 2 && bestD <= brakeDist * 1.15 + 10,
  };
}
