import type { CharacterId } from '../sim/types';
import type { WeaponKind } from '../sim/moves';
import type { HiltStyle } from './rig/weapons';

export type Costume = 'jedi' | 'marauder' | 'acrobat' | 'warden';

export interface CharacterLook {
  id: CharacterId;
  costume: Costume;
  /** Overall body scale (root scale). */
  scale: number;
  /** Limb/torso thickness multiplier. */
  bulk: number;
  skin: number;
  hair: number;
  primary: number;
  primaryDark: number;
  secondary: number;
  trousers: number;
  belt: number;
  boots: number;
  glove: number | null;
  metal: number;
  trim: number;
  /** Rim light tint for silhouette separation. */
  rim: number;
  /** Force/VFX color. */
  force: number;
  weapon: { kind: WeaponKind; blade: number; blade2: number; hilt: HiltStyle };
  /** CSS accent for UI. */
  ui: string;
}

export const LOOKS: Record<CharacterId, CharacterLook> = {
  kael: {
    id: 'kael',
    costume: 'jedi',
    scale: 1,
    bulk: 1,
    skin: 0xc28a68,
    hair: 0x3a2414,
    primary: 0x86643f,
    primaryDark: 0x563f29,
    secondary: 0xcabd9f,
    trousers: 0x4b3b2b,
    belt: 0x2e2016,
    boots: 0x22170f,
    glove: null,
    metal: 0xb7bec8,
    trim: 0x8c6a44,
    rim: 0x5fb4ff,
    force: 0x9fdcff,
    weapon: { kind: 'single', blade: 0x2b8cff, blade2: 0x2b8cff, hilt: { metal: 0xc9d0d8, grip: 0x1a1a1c, accent: 0x3a3d44 } },
    ui: '#45a6ff',
  },
  vexa: {
    id: 'vexa',
    costume: 'marauder',
    scale: 1.05,
    bulk: 1.14,
    skin: 0xb07c62,
    hair: 0x0c0c10,
    primary: 0x1d1c22,
    primaryDark: 0x111015,
    secondary: 0x2b2a31,
    trousers: 0x141318,
    belt: 0x6e0c14,
    boots: 0x0c0b0e,
    glove: 0x111114,
    metal: 0x40444c,
    trim: 0x8a121c,
    rim: 0xff4a4a,
    force: 0xff5470,
    weapon: { kind: 'single', blade: 0xff2020, blade2: 0xff2020, hilt: { metal: 0x3a3e46, grip: 0x101012, accent: 0x8a1018, shape: 'curved' } },
    ui: '#ff3d3d',
  },
  asha: {
    id: 'asha',
    costume: 'acrobat',
    scale: 0.95,
    bulk: 0.86,
    skin: 0x9a6248,
    hair: 0x1a0d0a,
    primary: 0x1f5f5a,
    primaryDark: 0x123a37,
    secondary: 0xc9783c,
    trousers: 0x183b3a,
    belt: 0x6a3d1e,
    boots: 0x2a1c14,
    glove: null,
    metal: 0xa9b3bb,
    trim: 0xd99a4e,
    rim: 0x6dff9a,
    force: 0x8dffb4,
    weapon: { kind: 'dual', blade: 0x2fe05a, blade2: 0x9cff3a, hilt: { metal: 0xb8c0c8, grip: 0x2a2d30, accent: 0x6a4a2a } },
    ui: '#3ee06a',
  },
  thane: {
    id: 'thane',
    costume: 'warden',
    scale: 1.06,
    bulk: 1.04,
    skin: 0xa8765c,
    hair: 0x2a2018,
    primary: 0xa39678,
    primaryDark: 0x786c57,
    secondary: 0x5a4632,
    trousers: 0x3a2e22,
    belt: 0x8a6a2a,
    boots: 0x2a2018,
    glove: 0x2a2420,
    metal: 0xe8dcc0,
    trim: 0xc89a3a,
    rim: 0xffd25a,
    force: 0xffe08a,
    weapon: { kind: 'staff', blade: 0xffc21a, blade2: 0xffc21a, hilt: { metal: 0xc9a24a, grip: 0x1e1a16, accent: 0xe8cf86 } },
    ui: '#ffc83d',
  },
};

/** Second palette for mirror matches (P2 picks the same duelist). */
const ALT: Record<CharacterId, Partial<CharacterLook> & { blade: number; blade2: number }> = {
  kael: { primary: 0x2c2b30, primaryDark: 0x1b1a1e, secondary: 0x46444c, trousers: 0x1e1d22, trim: 0x5a5560, rim: 0xc39bff, force: 0xd9c2ff, blade: 0x9d4dff, blade2: 0x9d4dff, ui: '#b57bff' },
  vexa: { primary: 0x4a0e14, primaryDark: 0x2c070b, secondary: 0x5c1a20, trousers: 0x22080b, trim: 0xd8a040, rim: 0xff9a3a, force: 0xffb070, blade: 0xff6a10, blade2: 0xff6a10, ui: '#ff8a2a' },
  asha: { primary: 0x3a2c62, primaryDark: 0x231a3e, secondary: 0xd8c8a0, trousers: 0x2a2244, trim: 0x9fd8ff, rim: 0x6ad8ff, force: 0xa8e8ff, blade: 0x2ab8ff, blade2: 0x6ae8ff, ui: '#3ec8ff' },
  thane: { primary: 0x40404a, primaryDark: 0x26262c, secondary: 0x8a8a96, trousers: 0x202026, trim: 0xc8d0e0, rim: 0xdfe8ff, force: 0xeef2ff, blade: 0xf4f6ff, blade2: 0xf4f6ff, ui: '#e8eeff' },
};

export function lookFor(id: CharacterId, alt = false): CharacterLook {
  const base = LOOKS[id];
  if (!alt) return base;
  const { blade, blade2, ...patch } = ALT[id];
  return { ...base, ...patch, weapon: { ...base.weapon, blade, blade2 } };
}
