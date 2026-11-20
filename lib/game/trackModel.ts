import * as THREE from "three";
import { gltfLoader } from "./gltf";
import type { Track } from "./track";

/**
 * A detailed 3D circuit drawn on top of our GeoJSON-based track.
 * Physics/timing keep using the GeoJSON centerline; the model is fitted onto it with a
 * 2D similarity transform (computed offline by ICP against the model's asphalt):
 *   model = scale * R(rotationY) * (ours - pivot) + pivot + offset
 */
export interface TrackModelDef {
  url: string;
  rotationY: number;
  scale: number;
  pivot: [number, number];
  offset: [number, number];
  credit: string;
}

export interface LoadedTrackModel {
  group: THREE.Group;
  heights: Float64Array; // asphalt height per centerline sample
  dispose: () => void;
}

const ASPHALT = /asphalt|asph_old|groove/i;

export async function loadTrackModel(
  def: TrackModelDef,
  track: Track,
  onProgress?: (loadedBytes: number, totalBytes: number) => void,
): Promise<LoadedTrackModel> {
  const gltf = await gltfLoader().loadAsync(def.url, (e) => {
    onProgress?.(e.loaded, e.total);
  });
  const model = gltf.scene;

  const inner = new THREE.Group();
  inner.add(model);
  inner.position.set(-(def.pivot[0] + def.offset[0]), 0, -(def.pivot[1] + def.offset[1]));
  const group = new THREE.Group();
  group.add(inner);
  group.position.set(def.pivot[0], 0, def.pivot[1]);
  group.rotation.y = def.rotationY; // three's +Y rotation == R(-θ) in our x/z convention
  group.scale.setScalar(1 / def.scale);
  group.updateMatrixWorld(true);

  // ---- render settings: big static scene, only receives shadows
  const asphalt: THREE.Mesh[] = [];
  const cheap = new Map<THREE.Material, THREE.Material>();
  model.traverse((o) => {
    // static: never recompute these matrices per frame
    o.matrixAutoUpdate = false;
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false;
    m.receiveShadow = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some((mat) => ASPHALT.test(mat.name))) asphalt.push(m);
    const next = mats.map((mat) => {
      let c = cheap.get(mat);
      if (!c) {
        c = toStandard(mat);
        cheap.set(mat, c);
      }
      return c;
    });
    m.material = Array.isArray(m.material) ? next : next[0];
  });
  model.updateMatrixWorld(true);

  // ---- height profile along the centerline from the asphalt vertices
  const cell = 4;
  const sum = new Map<string, [number, number]>();
  const v = new THREE.Vector3();
  for (const mesh of asphalt) {
    const pos = mesh.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const k = `${Math.floor(v.x / cell)},${Math.floor(v.z / cell)}`;
      const e = sum.get(k);
      if (e) {
        e[0] += v.y;
        e[1]++;
      } else sum.set(k, [v.y, 1]);
    }
  }
  const raw = new Float64Array(track.n).fill(NaN);
  for (let i = 0; i < track.n; i++) {
    const cx = Math.floor(track.px[i] / cell);
    const cz = Math.floor(track.pz[i] / cell);
    let s = 0;
    let c = 0;
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++) {
        const e = sum.get(`${cx + a},${cz + b}`);
        if (e) {
          s += e[0];
          c += e[1];
        }
      }
    if (c) raw[i] = s / c;
  }
  const heights = fillAndSmooth(raw);

  return {
    group,
    heights,
    dispose: () => {
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          for (const val of Object.values(mat)) if (val instanceof THREE.Texture) val.dispose();
          mat.dispose();
        }
      });
    },
  };
}

/** KHR_materials_specular makes GLTFLoader create MeshPhysicalMaterial, whose shader is much
 *  heavier. For scenery seen from the air a standard PBR material looks the same. */
function toStandard(mat: THREE.Material): THREE.Material {
  const p = mat as THREE.MeshPhysicalMaterial;
  if (!p.isMeshPhysicalMaterial) return mat;
  const s = new THREE.MeshStandardMaterial({
    name: p.name,
    color: p.color,
    map: p.map,
    normalMap: p.normalMap,
    normalScale: p.normalScale,
    roughness: p.roughness,
    roughnessMap: p.roughnessMap,
    metalness: p.metalness,
    metalnessMap: p.metalnessMap,
    aoMap: p.aoMap,
    emissive: p.emissive,
    emissiveMap: p.emissiveMap,
    emissiveIntensity: p.emissiveIntensity,
    alphaMap: p.alphaMap,
    transparent: p.transparent,
    opacity: p.opacity,
    alphaTest: p.alphaTest,
    side: p.side,
    vertexColors: p.vertexColors,
    depthWrite: p.depthWrite,
  });
  p.dispose();
  return s;
}

function fillAndSmooth(raw: Float64Array): Float64Array {
  const n = raw.length;
  const out = Float64Array.from(raw);
  const known: number[] = [];
  for (let i = 0; i < n; i++) if (!isNaN(raw[i])) known.push(i);
  if (!known.length) return new Float64Array(n);
  // linear interpolation across gaps (circular)
  for (let k = 0; k < known.length; k++) {
    const a = known[k];
    const b = known[(k + 1) % known.length];
    const gap = (b - a + n) % n || n;
    for (let g = 1; g < gap; g++) out[(a + g) % n] = raw[a] + ((raw[b] - raw[a]) * g) / gap;
  }
  // smooth ±6 samples, 3 passes
  let cur = out;
  for (let p = 0; p < 3; p++) {
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -6; j <= 6; j++) s += cur[(i + j + n) % n];
      next[i] = s / 13;
    }
    cur = next;
  }
  return cur;
}
