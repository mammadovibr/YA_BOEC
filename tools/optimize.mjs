// Compresses a glTF for mobile: WebP textures (size-capped) + meshopt geometry.
// usage: node tools/optimize.mjs in.glb out.glb [maxTex=1024] [colorTexPattern] [colorTexMax]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress, meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [, , inp, out, maxTex = '1024', bigPattern, bigMax = '2048'] = process.argv;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp);
const steps = [];
const n = Number(maxTex);
if (bigPattern) {
  const re = new RegExp(bigPattern);
  steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85, resize: [Number(bigMax), Number(bigMax)], pattern: re }));
  steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85, resize: [n, n], pattern: new RegExp(`^(?!${bigPattern.replace(/^\^|\$$/g, '')}$).*`) }));
} else {
  steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85, resize: [n, n] }));
}
steps.push(prune({ keepLeaves: true, keepAttributes: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await doc.transform(...steps);
await io.write(out, doc);
for (const t of doc.getRoot().listTextures()) console.log(t.getName(), t.getMimeType(), t.getSize(), t.getImage().byteLength);
