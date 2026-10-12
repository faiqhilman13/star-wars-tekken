// Headless CPU-vs-CPU smoke test for the fighting simulation, across every matchup.
// Bundle with rolldown and run with node.
import { CpuController, type Difficulty } from '../src/sim/Ai';
import { WALL_X } from '../src/sim/constants';
import { Match } from '../src/sim/Match';
import { CHARACTER_IDS, type CharacterId } from '../src/sim/types';
import { createSeededRandom } from '../src/utils/random';

function runMatch(seed: number, c0: CharacterId, c1: CharacterId, d0: Difficulty, d1: Difficulty) {
  const match = new Match([c0, c1]);
  const ai0 = new CpuController(match, 0, createSeededRandom(seed * 2 + 1), d0);
  const ai1 = new CpuController(match, 1, createSeededRandom(seed * 2 + 2), d1);
  const counts: Record<string, number> = {};
  const states = new Set<string>();
  let frames = 0;
  let floating = 0;
  while (match.phase !== 'matchOver' && frames < 60 * 60 * 12) {
    match.step(ai0.update(), ai1.update());
    frames += 1;
    for (const e of match.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    match.events.length = 0;
    for (const f of match.fighters) {
      states.add(f.state + (f.move ? ':' + f.move.id : ''));
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) throw new Error(`NaN position at frame ${frames}`);
      if (Math.abs(f.x) > WALL_X + 1e-6) throw new Error(`fighter ${f.id} outside wall: ${f.x}`);
      if (f.y < -1e-6) throw new Error(`fighter ${f.id} below floor: ${f.y}`);
      const ground = f.state === 'idle' || f.state === 'walk' || f.state === 'crouch' || f.state === 'block' || f.state === 'run';
      if (ground && f.y > 0) floating += 1;
    }
  }
  return { frames, phase: match.phase, winner: match.matchWinner, counts, states, floating };
}

const wins: Record<string, number> = {};
const totals: Record<string, number> = {};
const allStates = new Set<string>();
let unfinished = 0;
let floating = 0;
let matches = 0;
let seed = 1;
for (const a of CHARACTER_IDS) {
  for (const b of CHARACTER_IDS) {
    for (let r = 0; r < 3; r += 1) {
      const res = runMatch(seed++, a, b, 'normal', 'normal');
      matches += 1;
      if (res.phase !== 'matchOver') unfinished += 1;
      floating += res.floating;
      const w = res.winner === 0 ? a : res.winner === 1 ? b : 'draw';
      wins[w] = (wins[w] ?? 0) + 1;
      for (const [k, v] of Object.entries(res.counts)) totals[k] = (totals[k] ?? 0) + v;
      for (const s of res.states) allStates.add(s);
    }
  }
}
console.log(JSON.stringify({ matches, unfinished, floating, wins }));
console.log('events', JSON.stringify(totals));
console.log('states', [...allStates].sort().join(' '));
