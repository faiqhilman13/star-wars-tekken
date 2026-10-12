// Balance probe: CPU-vs-CPU over every non-mirror matchup, damage by character and move.
// Bundle with rolldown and run with node.
import { CpuController } from '../src/sim/Ai';
import { Match } from '../src/sim/Match';
import { CHARACTER_IDS } from '../src/sim/types';
import { createSeededRandom } from '../src/utils/random';

const dmg: Record<string, Record<string, number>> = {};
const wins: Record<string, number> = {};
const pair: Record<string, number> = {};
let seed = 100;
const reps = Number(process.argv[2] ?? 4);
for (const a of CHARACTER_IDS) {
  for (const b of CHARACTER_IDS) {
    if (a === b) continue;
    for (let r = 0; r < reps; r += 1) {
      const m = new Match([a, b]);
      const ai = [new CpuController(m, 0, createSeededRandom(seed * 2 + 1), 'normal'), new CpuController(m, 1, createSeededRandom(seed * 2 + 2), 'normal')];
      seed += 1;
      let frames = 0;
      while (m.phase !== 'matchOver' && frames < 60 * 60 * 12) {
        m.step(ai[0].update(), ai[1].update());
        frames += 1;
        for (const e of m.events) {
          if (e.type === 'hit') {
            const who = e.attacker === 0 ? a : b;
            dmg[who] ??= {};
            const key = e.blocked ? `${e.source}(chip)` : e.source;
            dmg[who][key] = (dmg[who][key] ?? 0) + e.damage;
          }
          if (e.type === 'gripTick') {
            const who = e.fighter === 0 ? a : b;
            dmg[who] ??= {};
            dmg[who]['gripTick'] = (dmg[who]['gripTick'] ?? 0) + 1;
          }
        }
        m.events.length = 0;
      }
      const w = m.matchWinner === 0 ? a : m.matchWinner === 1 ? b : 'draw';
      wins[w] = (wins[w] ?? 0) + 1;
      const k = [a, b].sort().join('-');
      if (w !== 'draw') pair[`${k}:${w}`] = (pair[`${k}:${w}`] ?? 0) + 1;
    }
  }
}
console.log('wins', JSON.stringify(wins));
console.log('pairs', JSON.stringify(pair));
for (const [c, d] of Object.entries(dmg)) console.log(c, JSON.stringify(Object.fromEntries(Object.entries(d).sort((x, y) => y[1] - x[1]))));
