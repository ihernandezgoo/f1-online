import * as THREE from "three";

export const HALF_WIDTH = 7; // asphalt half width (m)
export const KERB_WIDTH = 1.3;
export const RUNOFF = 13; // grass between kerb and barrier
const BASE_WALL = HALF_WIDTH + KERB_WIDTH + RUNOFF;
const MIN_WALL = HALF_WIDTH + KERB_WIDTH + 1.5;

export interface Track {
  id: string;
  name: string;
  n: number;
  ds: number;
  length: number;
  px: Float64Array; // centerline
  pz: Float64Array;
  tx: Float64Array; // unit tangent (driving direction)
  tz: Float64Array;
  nx: Float64Array; // unit left normal
  nz: Float64Array;
  k: Float64Array; // signed curvature (>0 = left turn)
  wallL: Float64Array; // distance from centerline to barrier on each side
  wallR: Float64Array;
  kerb: Uint8Array;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface GeoJson {
  features: { properties: { Name?: string; length?: number }; geometry: { coordinates: [number, number][] } }[];
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function circularSmooth(src: Float64Array, radius: number, passes = 1): Float64Array {
  const n = src.length;
  let a = Float64Array.from(src);
  for (let p = 0; p < passes; p++) {
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -radius; j <= radius; j++) s += a[(i + j + n) % n];
      b[i] = s / (2 * radius + 1);
    }
    a = b;
  }
  return a;
}

function circularMin(src: Float64Array, radius: number): Float64Array {
  const n = src.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = -radius; j <= radius; j++) m = Math.min(m, src[(i + j + n) % n]);
    out[i] = m;
  }
  return out;
}

export async function loadTrack(id: string): Promise<Track> {
  const res = await fetch(`/circuits/${id}.geojson`);
  if (!res.ok) throw new Error(`No se pudo cargar el circuito ${id}`);
  const gj = (await res.json()) as GeoJson;
  return buildTrack(id, gj);
}

export function projectCoords(coords: [number, number][]): { x: number; z: number }[] {
  let lon0 = 0;
  let lat0 = 0;
  for (const [lon, lat] of coords) {
    lon0 += lon;
    lat0 += lat;
  }
  lon0 /= coords.length;
  lat0 /= coords.length;
  const mLat = 110540;
  const mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  // north = -z so the map is not mirrored when seen from above
  return coords.map(([lon, lat]) => ({ x: (lon - lon0) * mLon, z: -(lat - lat0) * mLat }));
}

export function buildTrack(id: string, gj: GeoJson): Track {
  const feat = gj.features[0];
  let coords = feat.geometry.coordinates;
  const f = coords[0];
  const l = coords[coords.length - 1];
  if (f[0] === l[0] && f[1] === l[1]) coords = coords.slice(0, -1);

  const proj = projectCoords(coords);
  const curve = new THREE.CatmullRomCurve3(
    proj.map((p) => new THREE.Vector3(p.x, 0, p.z)),
    true,
    "centripetal",
  );
  const rawLen = curve.getLength();
  const official = feat.properties.length ?? rawLen;
  const scale = official / rawLen > 0.85 && official / rawLen < 1.2 ? official / rawLen : 1;
  const length = rawLen * scale;
  const n = Math.round(length / 2.5);
  const ds = length / n;
  const pts = curve.getSpacedPoints(n);

  let px: Float64Array = new Float64Array(n);
  let pz: Float64Array = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = pts[i].x * scale;
    pz[i] = pts[i].z * scale;
  }
  // light smoothing removes kinks left by the coarse source polyline
  px = circularSmooth(px, 2, 3);
  pz = circularSmooth(pz, 2, 3);

  const tx = new Float64Array(n);
  const tz = new Float64Array(n);
  const nx = new Float64Array(n);
  const nz = new Float64Array(n);
  const heading = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const dx = px[b] - px[a];
    const dz = pz[b] - pz[a];
    const len = Math.hypot(dx, dz) || 1;
    tx[i] = dx / len;
    tz[i] = dz / len;
    nx[i] = tz[i];
    nz[i] = -tx[i];
    heading[i] = Math.atan2(tx[i], tz[i]);
  }
  const kRaw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    kRaw[i] = wrapAngle(heading[(i + 1) % n] - heading[(i - 1 + n) % n]) / (2 * ds);
  }
  const k = circularSmooth(kRaw, 3, 2);

  // ---- barrier distances
  let wallL: Float64Array = new Float64Array(n).fill(BASE_WALL);
  let wallR: Float64Array = new Float64Array(n).fill(BASE_WALL);
  for (let i = 0; i < n; i++) {
    const ak = Math.abs(k[i]);
    if (ak < 1e-6) continue;
    const r = 0.8 / ak;
    if (k[i] > 0) wallL[i] = Math.min(wallL[i], r);
    else wallR[i] = Math.min(wallR[i], r);
  }
  // keep barriers from crossing other parts of the circuit
  const cell = 40;
  const grid = new Map<string, number[]>();
  const key = (cx: number, cz: number) => `${cx},${cz}`;
  for (let i = 0; i < n; i++) {
    const kk = key(Math.floor(px[i] / cell), Math.floor(pz[i] / cell));
    const arr = grid.get(kk);
    if (arr) arr.push(i);
    else grid.set(kk, [i]);
  }
  const reach = 2 * BASE_WALL + 4;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(px[i] / cell);
    const cz = Math.floor(pz[i] / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const arr = grid.get(key(gx, gz));
        if (!arr) continue;
        for (const j of arr) {
          const dx = px[j] - px[i];
          const dz = pz[j] - pz[i];
          const d = Math.hypot(dx, dz);
          if (d > reach) continue;
          const di = Math.abs(i - j);
          const along = Math.min(di, n - di) * ds;
          if (along < 30 || along < d * 2.5) continue;
          const side = dx * nx[i] + dz * nz[i];
          const lim = Math.max(MIN_WALL, d / 2 - 0.5);
          if (side > 0) wallL[i] = Math.min(wallL[i], lim);
          else wallR[i] = Math.min(wallR[i], lim);
        }
      }
    }
  }
  wallL = circularSmooth(circularMin(wallL, 6), 6);
  wallR = circularSmooth(circularMin(wallR, 6), 6);
  for (let i = 0; i < n; i++) {
    wallL[i] = Math.max(MIN_WALL, wallL[i]);
    wallR[i] = Math.max(MIN_WALL, wallR[i]);
  }

  // ---- kerbs on corners
  const kerbRaw = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (Math.abs(k[i]) > 1 / 320) kerbRaw[i] = 1;
  const kerb = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!kerbRaw[i]) continue;
    for (let j = -6; j <= 6; j++) kerb[(i + j + n) % n] = 1;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, px[i]);
    maxX = Math.max(maxX, px[i]);
    minZ = Math.min(minZ, pz[i]);
    maxZ = Math.max(maxZ, pz[i]);
  }

  return {
    id,
    name: feat.properties.Name ?? id,
    n,
    ds,
    length,
    px,
    pz,
    tx,
    tz,
    nx,
    nz,
    k,
    wallL,
    wallR,
    kerb,
    bounds: { minX, maxX, minZ, maxZ },
  };
}

/** Closest centerline sample to (x,z), searching around `hint` (or everywhere when hint < 0). */
export function nearestIndex(t: Track, x: number, z: number, hint: number, window = 40): number {
  let best = 0;
  let bestD = Infinity;
  if (hint < 0) {
    for (let i = 0; i < t.n; i++) {
      const d = (t.px[i] - x) ** 2 + (t.pz[i] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  for (let o = -window; o <= window; o++) {
    const i = (hint + o + t.n) % t.n;
    const d = (t.px[i] - x) ** 2 + (t.pz[i] - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** SVG path of the centerline (for minimap / previews). */
export function trackSvgPath(t: Track, step = 4): { d: string; viewBox: string } {
  const { minX, maxX, minZ, maxZ } = t.bounds;
  const pad = 60;
  let d = "";
  for (let i = 0; i < t.n; i += step) d += `${i === 0 ? "M" : "L"}${t.px[i].toFixed(1)} ${t.pz[i].toFixed(1)}`;
  d += "Z";
  return { d, viewBox: `${minX - pad} ${minZ - pad} ${maxX - minX + 2 * pad} ${maxZ - minZ + 2 * pad}` };
}

// ------------------------------------------------------------------ meshes

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, count: number, colors: string[], size = 1) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    g.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}

function ribbon(
  t: Track,
  inner: (i: number) => number,
  outer: (i: number) => number,
  yIn: number,
  yOut: number,
  vScale: number,
  filter?: (i: number) => boolean,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let v = 0;
  for (let s = 0; s < t.n; s++) {
    const i = s;
    const j = (s + 1) % t.n;
    if (filter && !filter(i)) {
      v += t.ds;
      continue;
    }
    const base = pos.length / 3;
    for (const p of [i, j]) {
      const a = inner(p);
      const b = outer(p);
      pos.push(t.px[p] + t.nx[p] * a, yIn, t.pz[p] + t.nz[p] * a);
      pos.push(t.px[p] + t.nx[p] * b, yOut, t.pz[p] + t.nz[p] * b);
    }
    uv.push(0, v / vScale, 1, v / vScale, 0, (v + t.ds) / vScale, 1, (v + t.ds) / vScale);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    v += t.ds;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface TrackScene {
  group: THREE.Group;
  startLights: THREE.MeshStandardMaterial[];
  dispose: () => void;
}

export function buildTrackScene(t: Track, maxAniso: number, gridSlots: { s: number; lat: number }[]): TrackScene {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(o: T) => {
    disposables.push(o);
    return o;
  };

  // --- ground
  const grassTex = keep(
    canvasTexture(256, 256, (g) => {
      g.fillStyle = "#3f7a2c";
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = "#45852f";
      g.fillRect(0, 0, 128, 256);
      noise(g, 256, 256, 5000, ["#356a25", "#4a8c33", "#3b7429"], 2);
    }),
  );
  const { minX, maxX, minZ, maxZ } = t.bounds;
  const gw = maxX - minX + 1200;
  const gh = maxZ - minZ + 1200;
  grassTex.repeat.set(gw / 24, gh / 24);
  grassTex.anisotropy = maxAniso;
  const ground = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(gw, gh)),
    keep(new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  ground.receiveShadow = true;
  group.add(ground);

  // --- asphalt
  const roadTex = keep(
    canvasTexture(256, 256, (g) => {
      g.fillStyle = "#3a3c40";
      g.fillRect(0, 0, 256, 256);
      noise(g, 256, 256, 9000, ["#2f3135", "#45474c", "#34363a", "#4d4f54"], 1);
      g.fillStyle = "#f2f2f2";
      g.fillRect(3, 0, 5, 256);
      g.fillRect(248, 0, 5, 256);
    }),
  );
  roadTex.wrapS = THREE.ClampToEdgeWrapping;
  roadTex.anisotropy = maxAniso;
  const road = new THREE.Mesh(
    keep(ribbon(t, () => HALF_WIDTH, () => -HALF_WIDTH, 0.03, 0.03, 18)),
    keep(new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92 })),
  );
  road.receiveShadow = true;
  group.add(road);

  // --- start/finish line + grid boxes
  const checker = keep(
    canvasTexture(128, 32, (g) => {
      for (let x = 0; x < 16; x++)
        for (let y = 0; y < 4; y++) {
          g.fillStyle = (x + y) % 2 ? "#111" : "#f5f5f5";
          g.fillRect(x * 8, y * 8, 8, 8);
        }
    }),
  );
  const lineMat = keep(new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8 }));
  const line = new THREE.Mesh(keep(new THREE.PlaneGeometry(HALF_WIDTH * 2, 2)), lineMat);
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = Math.atan2(t.tx[0], t.tz[0]);
  line.position.set(t.px[0], 0.04, t.pz[0]);
  line.receiveShadow = true;
  group.add(line);

  const white = keep(new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.8 }));
  const slotGeo = keep(new THREE.PlaneGeometry(2.6, 0.25));
  for (const slot of gridSlots) {
    const i = Math.round(slot.s / t.ds) % t.n;
    const ii = (i + 1) % t.n; // mark just in front of the car
    const m = new THREE.Mesh(slotGeo, white);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(t.tx[ii], t.tz[ii]);
    m.position.set(t.px[ii] + t.nx[ii] * slot.lat + t.tx[ii] * 1.2, 0.04, t.pz[ii] + t.nz[ii] * slot.lat + t.tz[ii] * 1.2);
    group.add(m);
  }

  // --- kerbs (vertex coloured red/white blocks)
  {
    const pos: number[] = [];
    const col: number[] = [];
    const red = new THREE.Color(0xd8262b);
    const wht = new THREE.Color(0xf4f4f4);
    for (const side of [1, -1]) {
      for (let i = 0; i < t.n; i++) {
        if (!t.kerb[i]) continue;
        const j = (i + 1) % t.n;
        const c = Math.floor((i * t.ds) / 2.5) % 2 ? red : wht;
        const a = HALF_WIDTH * side;
        const b = (HALF_WIDTH + KERB_WIDTH) * side;
        const v = (p: number, o: number, y: number) => [t.px[p] + t.nx[p] * o, y, t.pz[p] + t.nz[p] * o];
        const quad = [v(i, a, 0.05), v(i, b, 0.09), v(j, a, 0.05), v(i, b, 0.09), v(j, b, 0.09), v(j, a, 0.05)];
        if (side > 0) quad.reverse();
        for (const q of quad) {
          pos.push(...q);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const kerbs = new THREE.Mesh(g, keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })));
    kerbs.receiveShadow = true;
    group.add(kerbs);
  }

  // --- barriers
  const wallTex = keep(
    canvasTexture(512, 64, (g) => {
      const panels = ["#1d3fa8", "#f4f4f4", "#c8102e", "#f4f4f4", "#0f0f0f", "#f4f4f4"];
      for (let p = 0; p < panels.length; p++) {
        g.fillStyle = panels[p];
        g.fillRect(p * (512 / panels.length), 0, 512 / panels.length, 64);
      }
      g.fillStyle = "#9aa0a6";
      g.fillRect(0, 0, 512, 8);
    }),
  );
  wallTex.anisotropy = maxAniso;
  const wallMat = keep(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.6, side: THREE.DoubleSide }));
  const wallHeight = 1.15;
  for (const side of [1, -1]) {
    const geo = keep(wallRibbon(t, side, wallHeight));
    const wall = new THREE.Mesh(geo, wallMat);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  // --- start gantry with lights
  const startLights: THREE.MeshStandardMaterial[] = [];
  {
    const i = (t.n - 4) % t.n; // just before the line
    const head = Math.atan2(t.tx[i], t.tz[i]);
    const gantry = new THREE.Group();
    gantry.position.set(t.px[i], 0, t.pz[i]);
    gantry.rotation.y = head;
    const steel = keep(new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.6, roughness: 0.4 }));
    const span = Math.min(t.wallL[i], t.wallR[i], HALF_WIDTH + 4);
    const poleGeo = keep(new THREE.BoxGeometry(0.4, 7, 0.4));
    for (const s of [1, -1]) {
      const pole = new THREE.Mesh(poleGeo, steel);
      pole.position.set(s * span, 3.5, 0);
      pole.castShadow = true;
      gantry.add(pole);
    }
    const beam = new THREE.Mesh(keep(new THREE.BoxGeometry(span * 2 + 0.4, 0.7, 0.5)), steel);
    beam.position.set(0, 6.6, 0);
    beam.castShadow = true;
    gantry.add(beam);
    const panel = new THREE.Mesh(keep(new THREE.BoxGeometry(4.6, 1.3, 0.4)), keep(new THREE.MeshStandardMaterial({ color: 0x0c0c0c })));
    panel.position.set(0, 5.7, -0.1);
    gantry.add(panel);
    const lampGeo = keep(new THREE.CircleGeometry(0.28, 20));
    for (let l = 0; l < 5; l++) {
      const mat = keep(new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, emissiveIntensity: 3 }));
      startLights.push(mat);
      const lamp = new THREE.Mesh(lampGeo, mat);
      // lamps face the cars approaching from behind (-z in gantry space)
      lamp.rotation.y = Math.PI;
      lamp.position.set(-1.8 + l * 0.9, 5.7, -0.32);
      gantry.add(lamp);
    }
    group.add(gantry);
  }

  // --- grandstands along the main straight
  {
    const crowdTex = keep(
      canvasTexture(256, 64, (g) => {
        g.fillStyle = "#555";
        g.fillRect(0, 0, 256, 64);
        noise(g, 256, 64, 2200, ["#e63946", "#f1faee", "#a8dadc", "#457b9d", "#ffb703", "#222", "#fb8500", "#8ecae6"], 3);
      }),
    );
    crowdTex.repeat.set(6, 1);
    const standMat = keep(new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9 }));
    const roofMat = keep(new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.5 }));
    const stepGeo = keep(new THREE.BoxGeometry(60, 1.2, 3));
    const roofGeo = keep(new THREE.BoxGeometry(62, 0.3, 14));
    for (const off of [-30, -6, 18]) {
      const i = (Math.round(off / t.ds) + t.n * 10) % t.n;
      const side = t.wallR[i] >= t.wallL[i] ? -1 : 1;
      const d = (side > 0 ? t.wallL[i] : t.wallR[i]) + 4;
      const stand = new THREE.Group();
      stand.position.set(t.px[i] + t.nx[i] * d * side, 0, t.pz[i] + t.nz[i] * d * side);
      stand.rotation.y = Math.atan2(t.tx[i], t.tz[i]) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      for (let s = 0; s < 6; s++) {
        const step = new THREE.Mesh(stepGeo, standMat);
        step.position.set(0, 0.6 + s * 1.2, s * 2.2);
        step.castShadow = true;
        step.receiveShadow = true;
        stand.add(step);
      }
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.position.set(0, 10, 5.5);
      roof.castShadow = true;
      stand.add(roof);
      group.add(stand);
    }
  }

  // --- trees (instanced)
  {
    const cell = 30;
    const grid = new Set<string>();
    for (let i = 0; i < t.n; i += 2) grid.add(`${Math.floor(t.px[i] / cell)},${Math.floor(t.pz[i] / cell)}`);
    const nearTrack = (x: number, z: number) => {
      const cx = Math.floor(x / cell);
      const cz = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (grid.has(`${cx + a},${cz + b}`)) return true;
      return false;
    };
    const count = 700;
    const trunkGeo = keep(new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6));
    const leafGeo = keep(new THREE.ConeGeometry(2.4, 7, 7));
    const trunks = new THREE.InstancedMesh(trunkGeo, keep(new THREE.MeshStandardMaterial({ color: 0x5b3a21 })), count);
    const leaves = new THREE.InstancedMesh(leafGeo, keep(new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.9 })), count);
    leaves.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const leafColor = new THREE.Color();
    let placed = 0;
    for (let tries = 0; tries < count * 20 && placed < count; tries++) {
      const x = minX - 250 + Math.random() * (maxX - minX + 500);
      const z = minZ - 250 + Math.random() * (maxZ - minZ + 500);
      if (nearTrack(x, z)) continue;
      const sc = 0.7 + Math.random() * 0.8;
      s.set(sc, sc, sc);
      p.set(x, 1.2 * sc, z);
      m.compose(p, q, s);
      trunks.setMatrixAt(placed, m);
      p.set(x, (2.4 + 3.5) * sc, z);
      m.compose(p, q, s);
      leaves.setMatrixAt(placed, m);
      leafColor.setHSL(0.27 + Math.random() * 0.06, 0.45, 0.2 + Math.random() * 0.1);
      leaves.setColorAt(placed, leafColor);
      placed++;
    }
    trunks.count = placed;
    leaves.count = placed;
    group.add(trunks, leaves);
  }

  return {
    group,
    startLights,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

function wallRibbon(t: Track, side: number, h: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let v = 0;
  for (let i = 0; i <= t.n; i++) {
    const p = i % t.n;
    const d = (side > 0 ? t.wallL[p] : t.wallR[p]) * side;
    const x = t.px[p] + t.nx[p] * d;
    const z = t.pz[p] + t.nz[p] * d;
    pos.push(x, 0, z, x, h, z);
    uv.push(v / 30, 0, v / 30, 1);
    if (i < t.n) {
      const b = i * 2;
      if (side > 0) idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      else idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    v += t.ds;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
