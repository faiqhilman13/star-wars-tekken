// Export the game's procedural fighter costumes (src/render/rig/costumes.ts, body.ts) as JSON blockout data for the
// Blender pipeline: every mesh in rest/bind space (game axes: x toward the opponent, y up, z near), with its vertex
// colours, triangle indices, layer (solid / double / metal / visor), and skin weights by joint name (the 17 core
// joints plus the section 5 extras: skirt_aN_0/1, cape_N, hair_N, tail_N, pad_N/F). Read-only use of src/**.
//
//   node tools/blender/proc_export.mjs [kael,vexa,asha,thane] [--out art/characters]
//
// Writes art/characters/<id>/build/proc_<id>.json.
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const ids = (args.find((a) => !a.startsWith('--')) ?? 'kael,vexa,asha,thane').split(',');
const outIdx = args.indexOf('--out');
const outRoot = outIdx >= 0 ? args[outIdx + 1] : 'art/characters';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { FighterRig } = await server.ssrLoadModule('/src/render/rig/FighterRig.ts');
  const { LOOKS } = await server.ssrLoadModule('/src/render/characters.ts');
  for (const id of ids) {
    const rig = new FighterRig(LOOKS[id], { procedural: true });
    rig.root.updateMatrixWorld(true);
    const names = new Map();
    for (const [k, b] of Object.entries(rig.j)) names.set(b, k);
    const parts = rig.parts ?? {};
    const anchors = [];
    (parts.skirt?.anchors ?? []).forEach((a, i) => {
      names.set(a.upper, `skirt_a${i}_0`);
      names.set(a.lower, `skirt_a${i}_1`);
      anchors.push({ i, az: (Math.atan2(a.dir.z, a.dir.x) * 180) / Math.PI, side: a.side, long: a.long, len2: a.len2 });
    });
    (parts.cape ?? []).forEach((b, i) => names.set(b, `cape_${i}`));
    (parts.hair ?? []).forEach((b, i) => names.set(b, `hair_${i}`));
    (parts.tails ?? []).forEach((b, i) => names.set(b, `tail_${i}`));
    (parts.pads ?? []).forEach((p) => names.set(p.bone, p.arm === rig.j.upperN ? 'pad_N' : 'pad_F'));
    const weaponRoots = new Set([rig.weapon?.main, rig.weapon?.second].filter(Boolean));
    const underWeapon = (o) => {
      for (let p = o; p; p = p.parent) if (weaponRoots.has(p)) return true;
      return false;
    };
    const boneOf = (o) => {
      for (let p = o.parent; p; p = p.parent) if (names.has(p)) return names.get(p);
      return 'body';
    };
    const bones = [];
    for (const [b, name] of names) {
      const w = new (b.position.constructor)();
      b.getWorldPosition(w);
      bones.push({ name, parent: names.get(b.parent) ?? null, head: [w.x, w.y, w.z] });
    }
    const meshes = [];
    rig.root.traverse((o) => {
      if (!o.isMesh || underWeapon(o)) return;
      const g = o.geometry;
      const pos = g.getAttribute('position');
      const col = g.getAttribute('color');
      const idx = g.getIndex();
      const m = o.material;
      const layer = m === rig.cloth ? 'solid' : m === rig.clothDouble ? 'double' : m === rig.metal ? 'metal' : m?.isMeshBasicMaterial ? 'visor' : 'other';
      const P = [];
      const v = new (o.position.constructor)();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        P.push(+v.x.toFixed(5), +v.y.toFixed(5), +v.z.toFixed(5));
      }
      const rec = { name: o.name || '', layer, positions: P, indices: idx ? Array.from(idx.array) : null };
      if (col) rec.colors = Array.from(col.array, (x) => +x.toFixed(4));
      rec.colorItem = col ? col.itemSize : 0;
      if (o.isSkinnedMesh) {
        const si = g.getAttribute('skinIndex');
        const sw = g.getAttribute('skinWeight');
        rec.skinBones = o.skeleton.bones.map((b) => names.get(b) ?? 'body');
        rec.skinIndex = Array.from(si.array);
        rec.skinWeight = Array.from(sw.array, (x) => +x.toFixed(4));
      } else {
        rec.rigid = boneOf(o);
      }
      meshes.push(rec);
    });
    const out = path.join(outRoot, id, 'build');
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `proc_${id}.json`);
    fs.writeFileSync(file, JSON.stringify({ id, look: LOOKS[id], bones, anchors, meshes }));
    const tris = meshes.reduce((n, m) => n + (m.indices ? m.indices.length / 3 : m.positions.length / 9), 0);
    console.log(`${id}: ${meshes.length} meshes, ${Math.round(tris)} tris, ${bones.length} bones -> ${file}`);
  }
} finally {
  await server.close();
}
