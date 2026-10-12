import type { CharacterId } from '../../sim/types';
import { ashaAnims } from './asha';
import { kaelAnims } from './kael';
import { thaneAnims } from './thane';
import { vexaAnims } from './vexa';
import type { AnimSet } from './types';

type Factory = () => AnimSet;

/** Per-character animation sets (built lazily, cached). */
const factories: Partial<Record<CharacterId, Factory>> = {
  kael: kaelAnims,
  vexa: vexaAnims,
  asha: ashaAnims,
  thane: thaneAnims,
};

const cache: Partial<Record<CharacterId, AnimSet>> = {};

export function registerAnims(id: CharacterId, factory: Factory): void {
  factories[id] = factory;
  delete cache[id];
}

export function animsFor(id: CharacterId): AnimSet {
  const hit = cache[id];
  if (hit) return hit;
  const factory = factories[id] ?? kaelAnims;
  const set = factory();
  cache[id] = set;
  return set;
}
