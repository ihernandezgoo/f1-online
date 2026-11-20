import * as THREE from "three";
import { gltfLoader } from "./gltf";

/**
 * How GLB models are fitted. The bundled Sketchfab cars already face +Z at real scale.
 * Tweak rotationY if a new model's nose doesn't point forward (+Z).
 * Meshes whose material name contains one of `paintMaterials` get tinted; the current
 * models have their livery baked into textures, so the list is empty.
 */
export const MODEL_FIT = {
  rotationY: 0,
  length: 5.6,
  paintMaterials: [] as string[],
};

export interface CarVisual {
  root: THREE.Group;
  body: THREE.Group; // yaws with slip
  wheels: THREE.Object3D[]; // fl, fr, rl, rr (spin)
  steer: THREE.Object3D[]; // front wheel pivots
  dispose: () => void;
}

/** Box whose cross-section linearly morphs between z0 and z1. */
function taper(z0: number, w0: number, h0: number, y0: number, z1: number, w1: number, h1: number, y1: number) {
  const v = [
    [-w0 / 2, y0 - h0 / 2, z0], [w0 / 2, y0 - h0 / 2, z0], [w0 / 2, y0 + h0 / 2, z0], [-w0 / 2, y0 + h0 / 2, z0],
    [-w1 / 2, y1 - h1 / 2, z1], [w1 / 2, y1 - h1 / 2, z1], [w1 / 2, y1 + h1 / 2, z1], [-w1 / 2, y1 + h1 / 2, z1],
  ];
  const faces = [
    [0, 3, 2, 1], // back
    [4, 5, 6, 7], // front
    [0, 1, 5, 4], // bottom
    [3, 7, 6, 2], // top
    [0, 4, 7, 3], // right (-x)
    [1, 2, 6, 5], // left (+x)
  ];
  const pos: number[] = [];
  for (const [a, b, c, d] of faces) for (const k of [a, b, c, a, c, d]) pos.push(...v[k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// one parsed GLB per url, reused between sessions
const templates = new Map<string, Promise<THREE.Object3D | null>>();

function loadTemplate(url: string): Promise<THREE.Object3D | null> {
  let p = templates.get(url);
  if (!p) {
    p = gltfLoader()
      .loadAsync(url)
      .then((g) => g.scene)
      .catch((e) => {
        console.warn(`No se pudo cargar ${url}, uso el coche genérico`, e);
        templates.delete(url);
        return null;
      });
    templates.set(url, p);
  }
  return p;
}

/** Builds the selected car; falls back to the procedural one if the model is missing. */
export async function buildCar(model: string | null, color: number, accent: number): Promise<CarVisual> {
  const tpl = model ? await loadTemplate(model) : null;
  return tpl ? buildFromTemplate(tpl, color) : buildProcedural(color, accent);
}

function buildFromTemplate(tpl: THREE.Object3D, color: number): CarVisual {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const model = tpl.clone(true);
  model.rotation.y = MODEL_FIT.rotationY;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = MODEL_FIT.length / Math.max(size.x, size.z);
  model.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(model);
  const c = box2.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -box2.min.y, -c.z);
  const mats: THREE.Material[] = [];
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    const list = Array.isArray(m.material) ? m.material : [m.material];
    const next = list.map((mat) => {
      const name = mat.name.toLowerCase();
      if (MODEL_FIT.paintMaterials.some((p: string) => name.includes(p)) && "color" in mat) {
        const clone = mat.clone() as THREE.MeshStandardMaterial;
        clone.color = new THREE.Color(color);
        mats.push(clone);
        return clone;
      }
      return mat;
    });
    m.material = Array.isArray(m.material) ? next : next[0];
  });
  body.add(model);
  return { root, body, wheels: [], steer: [], dispose: () => mats.forEach((m) => m.dispose()) };
}

function buildProcedural(color: number, accent: number): CarVisual {
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(o: T) => {
    disposables.push(o);
    return o;
  };
  const paint = keep(new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.35 }));
  const accentMat = keep(new THREE.MeshStandardMaterial({ color: accent, metalness: 0.3, roughness: 0.4 }));
  const carbon = keep(new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.2, roughness: 0.55 }));
  const tyre = keep(new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
  const rim = keep(new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.8, roughness: 0.3 }));
  const stripe = keep(new THREE.MeshStandardMaterial({ color: 0xe0242a, roughness: 0.6 }));
  const helmet = keep(new THREE.MeshStandardMaterial({ color: 0xffd400, metalness: 0.2, roughness: 0.3 }));

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    keep(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    body.add(m);
    return m;
  };

  // floor & plank
  add(new THREE.BoxGeometry(1.45, 0.05, 3.5), carbon, 0, 0.09, -0.35);
  // nose
  add(taper(0.9, 0.52, 0.42, 0.45, 2.75, 0.2, 0.14, 0.27), paint);
  // cockpit / survival cell
  add(taper(-0.45, 0.8, 0.58, 0.44, 0.9, 0.56, 0.46, 0.46), paint);
  // sidepods
  for (const s of [1, -1]) {
    const pod = add(taper(-1.35, 0.28, 0.3, 0.32, 0.35, 0.5, 0.42, 0.37), paint);
    pod.position.x = s * 0.6;
    const inlet = add(new THREE.BoxGeometry(0.42, 0.3, 0.05), carbon, s * 0.6, 0.38, 0.37);
    inlet.castShadow = false;
  }
  // engine cover + airbox
  add(taper(-2.05, 0.22, 0.26, 0.44, -0.45, 0.6, 0.8, 0.7), paint);
  add(new THREE.BoxGeometry(0.24, 0.2, 0.1), carbon, 0, 1.02, -0.38);
  // T-cam / accent fin
  add(taper(-1.9, 0.03, 0.12, 0.62, -0.5, 0.03, 0.3, 1.0), accentMat);
  // nose accent stripe
  add(taper(1.4, 0.36, 0.03, 0.58, 2.6, 0.16, 0.03, 0.37), accentMat);

  // front wing
  add(new THREE.BoxGeometry(1.95, 0.035, 0.45), carbon, 0, 0.12, 2.72);
  add(new THREE.BoxGeometry(1.75, 0.03, 0.22), accentMat, 0, 0.2, 2.62).rotation.x = 0.35;
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.03, 0.24, 0.55), carbon, s * 0.98, 0.18, 2.7);

  // rear wing
  add(new THREE.BoxGeometry(1.0, 0.05, 0.32), paint, 0, 0.92, -2.4).rotation.x = -0.12;
  add(new THREE.BoxGeometry(1.0, 0.035, 0.2), accentMat, 0, 1.03, -2.5).rotation.x = -0.45;
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.03, 0.62, 0.7), carbon, s * 0.51, 0.72, -2.4);
  add(new THREE.BoxGeometry(0.06, 0.5, 0.12), carbon, 0, 0.62, -2.32);
  // diffuser
  add(taper(-2.4, 1.1, 0.06, 0.14, -1.9, 1.2, 0.04, 0.1), carbon);

  // halo
  const halo = add(new THREE.TorusGeometry(0.33, 0.032, 8, 24, Math.PI), carbon, 0, 0.82, 0.05);
  halo.rotation.x = Math.PI / 2;
  const pillar = add(new THREE.BoxGeometry(0.05, 0.3, 0.05), carbon, 0, 0.7, 0.4);
  pillar.rotation.x = -0.4;
  // driver
  add(new THREE.SphereGeometry(0.15, 16, 12), helmet, 0, 0.78, -0.05);
  // mirrors
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.16, 0.07, 0.04), paint, s * 0.45, 0.78, 0.45);

  // suspension arms (visual)
  for (const zz of [1.75, -1.85]) {
    for (const s of [1, -1]) {
      const arm = add(new THREE.BoxGeometry(0.5, 0.03, 0.05), carbon, s * 0.5, 0.36, zz);
      arm.castShadow = false;
    }
  }

  // wheels
  const wheels: THREE.Object3D[] = [];
  const steer: THREE.Object3D[] = [];
  const mkWheel = (x: number, z: number, w: number, front: boolean) => {
    const r = 0.36;
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    root.add(pivot);
    const spin = new THREE.Group();
    pivot.add(spin);
    const tg = keep(new THREE.CylinderGeometry(r, r, w, 28));
    tg.rotateZ(Math.PI / 2);
    const t = new THREE.Mesh(tg, tyre);
    t.castShadow = true;
    spin.add(t);
    const rg = keep(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.012, 18));
    rg.rotateZ(Math.PI / 2);
    spin.add(new THREE.Mesh(rg, rim));
    const sg = keep(new THREE.CylinderGeometry(r * 0.8, r * 0.8, w + 0.006, 28));
    sg.rotateZ(Math.PI / 2);
    spin.add(new THREE.Mesh(sg, stripe));
    const spoke = keep(new THREE.BoxGeometry(w + 0.03, r * 1.1, 0.06));
    spin.add(new THREE.Mesh(spoke, carbon));
    wheels.push(spin);
    if (front) steer.push(pivot);
  };
  mkWheel(0.8, 1.75, 0.3, true);
  mkWheel(-0.8, 1.75, 0.3, true);
  mkWheel(0.78, -1.85, 0.4, false);
  mkWheel(-0.78, -1.85, 0.4, false);

  return { root, body, wheels, steer, dispose: () => disposables.forEach((d) => d.dispose()) };
}
