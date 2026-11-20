// Builds the game-ready models in public/models from the originals in assets/models-src.
//   npm run optimize-models             -> everything
//   npm run optimize-models -- ferrari  -> only files whose path contains "ferrari"
//
// - textures resized and re-encoded as WebP (EXT_texture_webp)
// - meshes welded, simplified, joined (fewer draw calls) and meshopt-compressed
//   (three.js needs MeshoptDecoder, see lib/game/gltf.ts)
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { dedup, flatten, join as joinMeshes, meshopt, prune, simplify, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const SRC = "assets/models-src";
const OUT = "public/models";
const filter = process.argv[2]?.toLowerCase();

// circuits fill the screen; cars are small from the aerial camera
const PRESETS = {
  tracks: { textureSize: 2048, simplifyRatio: 0.25, simplifyError: 0.0003 },
  cars: { textureSize: 1024, simplifyRatio: 0.25, simplifyError: 0.0015 },
};

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".glb") ? [p] : [];
  });
}

async function toWebp(buf, maxSize, isNormal) {
  const resize = { width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: true };
  const webp = isNormal ? { quality: 92 } : { quality: 80, alphaQuality: 90 };
  try {
    return await sharp(buf).resize(resize).webp(webp).toBuffer();
  } catch {
    // some 16-bit / odd-colourspace PNGs: normalise to 8-bit sRGB first
    const raw = await sharp(buf).toColourspace("srgb").png({ force: true }).toBuffer();
    return sharp(raw).resize(resize).webp(webp).toBuffer();
  }
}

async function compressTextures(doc, maxSize) {
  const ext = doc.createExtension(EXTTextureWebP).setRequired(true);
  const normals = new Set(doc.getRoot().listMaterials().map((m) => m.getNormalTexture()).filter(Boolean));
  let before = 0;
  let after = 0;
  let failed = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    before += img.byteLength;
    try {
      const out = await toWebp(Buffer.from(img), maxSize, normals.has(tex));
      tex.setImage(new Uint8Array(out)).setMimeType("image/webp");
      if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.\w+$/, ".webp"));
      after += out.byteLength;
    } catch (e) {
      failed++;
      after += img.byteLength;
      console.warn(`  ! texture "${tex.getName()}" kept as is: ${e.message}`);
    }
  }
  if (!failed && !doc.getRoot().listTextures().some((t) => t.getMimeType() !== "image/webp")) ext.setRequired(true);
  console.log(`  textures ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB${failed ? ` (${failed} kept)` : ""}`);
}

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });

for (const src of walk(SRC)) {
  if (filter && !src.toLowerCase().includes(filter)) continue;
  const rel = relative(SRC, src);
  const out = join(OUT, rel);
  const preset = rel.startsWith("tracks") ? PRESETS.tracks : PRESETS.cars;
  const t0 = Date.now();
  console.log(`\n▶ ${rel}`);
  const doc = await io.read(src);
  await doc.transform(
    dedup(),
    flatten(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: preset.simplifyRatio, error: preset.simplifyError }),
    joinMeshes(),
    prune(),
  );
  await compressTextures(doc, preset.textureSize);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  mkdirSync(dirname(out), { recursive: true });
  await io.write(out, doc);
  const mb = (p) => (statSync(p).size / 1e6).toFixed(1);
  console.log(`  ${mb(src)} MB -> ${mb(out)} MB  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
