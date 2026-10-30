// Bake a scanned mesh's texture into vertex colours so seams stop blocking simplification.
// Used to make models/tesla_roadster_2026.lite.glb (28.6 MB, 500k triangles -> 0.5 MB, 40k):
//   node scripts/bake-vertex-colors.mjs models/tesla_roadtser_2026.glb models/tesla_roadster_2026.lite.glb 0.08 0.01
// Its dependencies are not part of the game; install them first (e.g. in a scratch folder):
//   npm i @gltf-transform/core@4.1.1 @gltf-transform/functions@4.1.1 @gltf-transform/extensions@4.1.1 meshoptimizer@0.22.0 sharp@0.33.5
// Usage: node bake-vertex-colors.mjs <in.glb> <out.glb> <ratio> <error>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { dedup, flatten, join, normals, prune, quantize, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [input, output, ratio = '0.05', error = '0.01'] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const decoded = new Map();
async function pixels(texture) {
  if (!decoded.has(texture)) {
    const { data, info } = await sharp(Buffer.from(texture.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    decoded.set(texture, { data, w: info.width, h: info.height });
  }
  return decoded.get(texture);
}

let before = 0, unlit = false;
const baked = new Map();
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const material = prim.getMaterial();
    // Some scans store their colour as an emissive texture over a black, unlit-looking base.
    const emissive = !material?.getBaseColorTexture() && !!material?.getEmissiveTexture();
    const texture = emissive ? material.getEmissiveTexture() : material?.getBaseColorTexture();
    const uv = prim.getAttribute('TEXCOORD_0');
    const position = prim.getAttribute('POSITION');
    before += (prim.getIndices()?.getCount() ?? position.getCount()) / 3;
    if (!texture || !uv) continue;
    const { data, w, h } = await pixels(texture);
    const factor = emissive ? material.getEmissiveFactor() : material.getBaseColorFactor();
    const colors = new Float32Array(position.getCount() * 4);
    const t = [0, 0];
    for (let i = 0; i < position.getCount(); i++) {
      uv.getElement(i, t);
      const x = Math.min(w - 1, Math.max(0, Math.floor((t[0] - Math.floor(t[0])) * w)));
      const y = Math.min(h - 1, Math.max(0, Math.floor((t[1] - Math.floor(t[1])) * h)));
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) colors[i * 4 + c] = srgbToLinear(data[o + c] / 255) * factor[c];
      colors[i * 4 + 3] = 1;
    }
    prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(colors).setBuffer(position.getBuffer()));
    for (const semantic of prim.listSemantics()) if (semantic !== 'POSITION' && semantic !== 'COLOR_0') prim.setAttribute(semantic, null);
    baked.set(material, emissive);
  }
}
// Materials are shared between primitives, so convert them only after every primitive is baked.
for (const [material, emissive] of baked) {
  material.setBaseColorTexture(null).setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]).setBaseColorFactor([1, 1, 1, 1]);
  if (emissive) material.setExtension('KHR_materials_unlit', doc.createExtension(KHRMaterialsUnlit).createUnlit());
  unlit ||= emissive;
}

await doc.transform(dedup(), flatten(), join());

// Weld by position only, averaging colours, so former texture seams no longer split the surface.
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const pos = prim.getAttribute('POSITION').getArray(), col = prim.getAttribute('COLOR_0')?.getArray();
  const idx = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
  let min = Infinity, max = -Infinity;
  for (const v of pos) { min = Math.min(min, v); max = Math.max(max, v); }
  const q = (max - min) * 1e-5, map = new Map(), remap = new Uint32Array(pos.length / 3);
  const outPos = [], outCol = [], counts = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const key = `${Math.round(pos[i * 3] / q)},${Math.round(pos[i * 3 + 1] / q)},${Math.round(pos[i * 3 + 2] / q)}`;
    let j = map.get(key);
    if (j === undefined) { j = counts.length; map.set(key, j); outPos.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); outCol.push(0, 0, 0, 0); counts.push(0); }
    if (col) for (let c = 0; c < 4; c++) outCol[j * 4 + c] += col[i * 4 + c];
    counts[j]++;
    remap[i] = j;
  }
  for (let j = 0; j < counts.length; j++) for (let c = 0; c < 4; c++) outCol[j * 4 + c] /= counts[j];
  const buffer = prim.getAttribute('POSITION').getBuffer();
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(outPos)).setBuffer(buffer));
  if (col) prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(outCol)).setBuffer(buffer));
  const newIdx = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) newIdx[i] = remap[idx[i]];
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(newIdx).setBuffer(buffer));
  console.log('welded vertices', pos.length / 3, '->', counts.length);
}

await doc.transform(
  simplify({ simplifier: MeshoptSimplifier, ratio: Number(ratio), error: Number(error), lockBorder: false }),
  ...(unlit ? [] : [normals({ overwrite: true })]),
  prune(),
  quantize(),
);

let after = 0;
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) after += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
await io.write(output, doc);
console.log(`triangles ${Math.round(before)} -> ${Math.round(after)}`);
