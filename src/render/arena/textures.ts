import * as THREE from 'three';

/**
 * Procedural canvas textures for the Reactor Gantry stage.
 *
 * Data textures pack three scalar maps into one image so a single texture can
 * serve as bumpMap (R), roughnessMap (G) and metalnessMap (B) at once.
 */

export type Rng = () => number;

export interface ArenaTextures {
  /** Unique deck plate albedo covering x ∈ [-10, 10], z ∈ [-2.5, 2.5]. */
  deckAlbedo: THREE.CanvasTexture;
  /** Deck data: R = height (bump), G = roughness, B = metalness. */
  deckData: THREE.CanvasTexture;
  /** Tileable steel panel albedo (one tile = PANEL_TILE world units). */
  panelAlbedo: THREE.CanvasTexture;
  /** Tileable steel panel data: R = height, G = roughness, B = metalness. */
  panelData: THREE.CanvasTexture;
  /** Tileable diagonal hazard stripes (one tile = HAZARD_TILE world units). */
  hazard: THREE.CanvasTexture;
  /** Stencil decal atlas (white glyphs on transparent). */
  decals: THREE.CanvasTexture;
  /** Tileable fbm noise: R = low freq, G = high freq, B = vertical streaks. */
  noise: THREE.CanvasTexture;
}

export const DECK_TEX_X0 = -10;
export const DECK_TEX_X1 = 10;
export const DECK_TEX_Z0 = -2.5;
export const DECK_TEX_Z1 = 2.5;
export const PANEL_TILE = 2.5;
export const HAZARD_TILE = 1.6;

/** Decal atlas regions as [u0, v0, u1, v1] in UV space (v up). */
export const DECAL_REGIONS = {
  num07: [0, 0.5, 0.25, 1.0],
  num08: [0.25, 0.5, 0.5, 1.0],
  danger: [0.5, 0.75, 1.0, 1.0],
  voltage: [0.5, 0.5, 1.0, 0.75],
  gantry: [0.0, 0.25, 0.5, 0.5],
  chevrons: [0.0, 0.0, 0.5, 0.25],
  warnTri: [0.5, 0.0, 0.75, 0.5],
  arrowUp: [0.75, 0.0, 1.0, 0.5],
} as const;
export type DecalName = keyof typeof DECAL_REGIONS;

function canvas2d(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Arena: 2D canvas context unavailable');
  return { canvas, ctx };
}

/** Tileable value noise over [0,1)^2 with integer cell counts. */
function valueNoise(rng: Rng, cx: number, cy: number): (u: number, v: number) => number {
  const g = new Float32Array(cx * cy);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return (u: number, v: number): number => {
    const x = u * cx;
    const y = v * cy;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const xa = ((x0 % cx) + cx) % cx;
    const xb = (xa + 1) % cx;
    const ya = ((y0 % cy) + cy) % cy;
    const yb = (ya + 1) % cy;
    const a = g[ya * cx + xa];
    const b = g[ya * cx + xb];
    const c = g[yb * cx + xa];
    const d = g[yb * cx + xb];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fbm(rng: Rng, cx: number, cy: number, octaves: number): (u: number, v: number) => number {
  const layers: Array<(u: number, v: number) => number> = [];
  for (let i = 0; i < octaves; i++) layers.push(valueNoise(rng, cx << i, cy << i));
  return (u: number, v: number): number => {
    let s = 0;
    let amp = 0.5;
    let norm = 0;
    for (const layer of layers) {
      s += amp * layer(u, v);
      norm += amp;
      amp *= 0.5;
    }
    return s / norm;
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** rgb() string for a packed data texel: height, roughness, metalness in [0,1]. */
function dataRgb(h: number, r: number, m: number, a = 1): string {
  return `rgba(${Math.round(clamp01(h) * 255)},${Math.round(clamp01(r) * 255)},${Math.round(clamp01(m) * 255)},${a})`;
}

function finishTexture(
  canvas: HTMLCanvasElement,
  srgb: boolean,
  repeat: boolean,
  anisotropy: number,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Deck plate (unique, covers the playable stretch of the bridge)
// ---------------------------------------------------------------------------

function buildDeck(rng: Rng): { albedo: HTMLCanvasElement; data: HTMLCanvasElement } {
  const W = 2048;
  const H = 512;
  const S = W / (DECK_TEX_X1 - DECK_TEX_X0); // px per world unit (102.4)
  const X = (x: number): number => (x - DECK_TEX_X0) * S;
  const Y = (z: number): number => (z - DECK_TEX_Z0) * S; // canvas top = back edge (z = -2.5)
  const a = canvas2d(W, H);
  const d = canvas2d(W, H);
  const A = a.ctx;
  const D = d.ctx;

  // Base gunmetal.
  A.fillStyle = 'rgb(84,91,101)';
  A.fillRect(0, 0, W, H);
  D.fillStyle = dataRgb(0.5, 0.46, 0.78);
  D.fillRect(0, 0, W, H);

  // Anti-slip diamond tread strips along front and back edges.
  const treadBands: Array<[number, number]> = [
    [-2.5, -2.04],
    [2.04, 2.5],
  ];
  for (const [z0, z1] of treadBands) {
    A.fillStyle = 'rgb(74,80,88)';
    A.fillRect(0, Y(z0), W, Y(z1) - Y(z0));
    D.fillStyle = dataRgb(0.42, 0.56, 0.8);
    D.fillRect(0, Y(z0), W, Y(z1) - Y(z0));
    const step = 0.105 * S;
    let row = 0;
    for (let py = Y(z0) + step * 0.55; py < Y(z1) - step * 0.3; py += step, row++) {
      let col = 0;
      for (let px = (row % 2) * step * 0.5; px < W + step; px += step, col++) {
        const ang = (col + row) % 2 === 0 ? 0.62 : -0.62;
        for (const [ctx, style] of [
          [A, 'rgb(118,125,134)'],
          [D, dataRgb(0.86, 0.36, 0.86)],
        ] as const) {
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(ang);
          ctx.fillStyle = style;
          ctx.beginPath();
          ctx.ellipse(0, 0, step * 0.4, step * 0.11, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  // Plate rows and staggered seams.
  const rows: Array<[number, number, number]> = [
    [-2.04, -0.68, 0],
    [-0.68, 0.68, 1.25],
    [0.68, 2.04, 0],
  ];
  const seamsX: Array<[number, number, number]> = []; // x, z0, z1
  for (const [z0, z1, off] of rows) {
    for (let x = DECK_TEX_X0 - 2.5 + off; x <= DECK_TEX_X1 + 2.5; x += 2.5) {
      // per-plate tint variation
      const t = (rng() - 0.5) * 0.09;
      A.fillStyle = t > 0 ? `rgba(160,168,178,${t})` : `rgba(10,12,16,${-t})`;
      A.fillRect(X(x), Y(z0), 2.5 * S, Y(z1) - Y(z0));
      D.fillStyle = dataRgb(0.5, 0.46 + (rng() - 0.5) * 0.12, 0.78, 0.6);
      D.fillRect(X(x), Y(z0), 2.5 * S, Y(z1) - Y(z0));
      seamsX.push([x, z0, z1]);
    }
  }

  // Polished walking lane: fine scuffs along x (foot slides).
  for (let i = 0; i < 900; i++) {
    const x = DECK_TEX_X0 + rng() * 20;
    const z = (rng() - 0.5) * 2.6 * (0.4 + 0.6 * rng());
    const len = (0.08 + rng() * 0.5) * S;
    const alpha = 0.03 + rng() * 0.06;
    A.strokeStyle = `rgba(178,186,198,${alpha})`;
    A.lineWidth = 1 + rng() * 1.5;
    A.beginPath();
    A.moveTo(X(x), Y(z));
    A.lineTo(X(x) + len, Y(z) + (rng() - 0.5) * 4);
    A.stroke();
    D.strokeStyle = dataRgb(0.5, 0.3, 0.85, alpha * 3);
    D.lineWidth = A.lineWidth;
    D.beginPath();
    D.moveTo(X(x), Y(z));
    D.lineTo(X(x) + len, Y(z) + (rng() - 0.5) * 4);
    D.stroke();
  }
  // Lane polish band (lower roughness in the centre).
  const polish = D.createLinearGradient(0, Y(-1.5), 0, Y(1.5));
  polish.addColorStop(0, dataRgb(0.5, 0.46, 0.8, 0));
  polish.addColorStop(0.5, dataRgb(0.5, 0.32, 0.86, 0.55));
  polish.addColorStop(1, dataRgb(0.5, 0.46, 0.8, 0));
  D.fillStyle = polish;
  D.fillRect(0, Y(-1.5), W, Y(1.5) - Y(-1.5));

  // Seams: dark groove + bevel highlight.
  const seamH = (z: number): void => {
    A.fillStyle = 'rgb(18,20,24)';
    A.fillRect(0, Y(z) - 2, W, 4);
    A.fillStyle = 'rgba(190,198,210,0.28)';
    A.fillRect(0, Y(z) + 2, W, 1);
    D.fillStyle = dataRgb(0.08, 0.78, 0.55);
    D.fillRect(0, Y(z) - 2, W, 4);
    D.fillStyle = dataRgb(0.62, 0.4, 0.8);
    D.fillRect(0, Y(z) + 2, W, 1);
  };
  for (const z of [-2.04, -0.68, 0.68, 2.04]) seamH(z);
  for (const [x, z0, z1] of seamsX) {
    A.fillStyle = 'rgb(18,20,24)';
    A.fillRect(X(x) - 2, Y(z0), 4, Y(z1) - Y(z0));
    A.fillStyle = 'rgba(190,198,210,0.25)';
    A.fillRect(X(x) + 2, Y(z0), 1, Y(z1) - Y(z0));
    D.fillStyle = dataRgb(0.08, 0.78, 0.55);
    D.fillRect(X(x) - 2, Y(z0), 4, Y(z1) - Y(z0));
  }

  // Rivets.
  const rivet = (x: number, z: number): void => {
    const px = X(x);
    const py = Y(z);
    A.fillStyle = 'rgba(12,14,18,0.55)';
    A.beginPath();
    A.arc(px + 0.8, py + 0.8, 3.6, 0, Math.PI * 2);
    A.fill();
    const g = A.createRadialGradient(px - 1, py - 1, 0.2, px, py, 3);
    g.addColorStop(0, 'rgb(196,204,214)');
    g.addColorStop(1, 'rgb(70,76,86)');
    A.fillStyle = g;
    A.beginPath();
    A.arc(px, py, 2.7, 0, Math.PI * 2);
    A.fill();
    D.fillStyle = dataRgb(0.96, 0.32, 0.9);
    D.beginPath();
    D.arc(px, py, 2.7, 0, Math.PI * 2);
    D.fill();
  };
  for (const z of [-2.04, -0.68, 0.68, 2.04]) {
    for (let x = DECK_TEX_X0 + 0.16; x < DECK_TEX_X1; x += 0.32) {
      rivet(x, z - 0.09);
      rivet(x, z + 0.09);
    }
  }
  for (const [x, z0, z1] of seamsX) {
    for (let z = z0 + 0.2; z < z1 - 0.1; z += 0.3) {
      rivet(x - 0.09, z);
      rivet(x + 0.09, z);
    }
  }

  // Saber scorch marks in the fighting lane.
  for (let i = 0; i < 9; i++) {
    const x = (rng() - 0.5) * 13;
    const z = (rng() - 0.5) * 2.2;
    const r = (0.18 + rng() * 0.35) * S;
    const sx = 1 + rng() * 2.2;
    for (const [ctx, c0, c1] of [
      [A, 'rgba(14,12,10,0.55)', 'rgba(14,12,10,0)'],
      [D, dataRgb(0.45, 0.82, 0.45, 0.6), dataRgb(0.45, 0.82, 0.45, 0)],
    ] as const) {
      ctx.save();
      ctx.translate(X(x), Y(z));
      ctx.scale(sx, 1);
      ctx.rotate((rng() - 0.5) * 0.3);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // a thin melted slash line through the scorch
    A.strokeStyle = 'rgba(150,90,50,0.25)';
    A.lineWidth = 1.5;
    A.beginPath();
    const ang = (rng() - 0.5) * 1.2;
    A.moveTo(X(x) - Math.cos(ang) * r * 1.2, Y(z) - Math.sin(ang) * r * 0.5);
    A.lineTo(X(x) + Math.cos(ang) * r * 1.2, Y(z) + Math.sin(ang) * r * 0.5);
    A.stroke();
  }

  // Hazard zones in front of both bulkheads.
  const yellow = 'rgb(212,160,38)';
  const black = 'rgb(26,26,28)';
  for (const s of [-1, 1]) {
    const xa = s > 0 ? 7.2 : -8.5;
    const xb = s > 0 ? 8.5 : -7.2;
    const z0 = -2.04;
    const z1 = 2.04;
    const rx = X(xa);
    const ry = Y(z0);
    const rw = X(xb) - X(xa);
    const rh = Y(z1) - Y(z0);
    A.save();
    A.beginPath();
    A.rect(rx, ry, rw, rh);
    A.clip();
    A.fillStyle = black;
    A.fillRect(rx, ry, rw, rh);
    A.fillStyle = yellow;
    const period = 0.36 * S;
    for (let k = -rh; k < rw + rh; k += period) {
      A.beginPath();
      const dir = s; // stripes lean toward the wall
      A.moveTo(rx + k, ry);
      A.lineTo(rx + k + period * 0.5, ry);
      A.lineTo(rx + k + period * 0.5 + dir * rh, ry + rh);
      A.lineTo(rx + k + dir * rh, ry + rh);
      A.closePath();
      A.fill();
    }
    // worn paint: scratches and chips expose metal
    for (let i = 0; i < 260; i++) {
      const px = rx + rng() * rw;
      const py = ry + rng() * rh;
      A.fillStyle = `rgba(92,98,106,${0.35 + rng() * 0.5})`;
      if (rng() < 0.7) {
        A.fillRect(px, py, 2 + rng() * 10, 1 + rng() * 2);
      } else {
        A.beginPath();
        A.arc(px, py, 1 + rng() * 4, 0, Math.PI * 2);
        A.fill();
      }
    }
    A.restore();
    // edge line facing the arena
    const edgeX = s > 0 ? X(7.12) : X(-7.2);
    A.fillStyle = yellow;
    A.fillRect(edgeX, ry, 0.08 * S, rh);
    D.fillStyle = dataRgb(0.55, 0.62, 0.12);
    D.fillRect(rx, ry, rw, rh);
    D.fillRect(edgeX, ry, 0.08 * S, rh);
    // threshold under the bulkhead: dark, grimy
    const tx0 = s > 0 ? X(8.5) : X(-10);
    const tx1 = s > 0 ? X(10) : X(-8.5);
    A.fillStyle = 'rgba(16,16,18,0.55)';
    A.fillRect(tx0, 0, tx1 - tx0, H);
    D.fillStyle = dataRgb(0.4, 0.75, 0.6, 0.8);
    D.fillRect(tx0, 0, tx1 - tx0, H);
  }

  // Safety lines along the edges (worn amber paint).
  for (const z of [-2.12, 2.12]) {
    A.fillStyle = 'rgba(200,150,40,0.75)';
    A.fillRect(X(-7.2), Y(z) - 0.03 * S, X(7.12) - X(-7.2), 0.06 * S);
    D.fillStyle = dataRgb(0.55, 0.62, 0.15);
    D.fillRect(X(-7.2), Y(z) - 0.03 * S, X(7.12) - X(-7.2), 0.06 * S);
  }

  // Centre marking: worn painted reactor sigil.
  const paint = 'rgba(206,214,224,0.30)';
  A.strokeStyle = paint;
  A.lineWidth = 0.05 * S;
  A.beginPath();
  A.arc(X(0), Y(0), 0.6 * S, 0, Math.PI * 2);
  A.stroke();
  A.lineWidth = 0.02 * S;
  A.beginPath();
  A.arc(X(0), Y(0), 0.42 * S, 0, Math.PI * 2);
  A.stroke();
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    A.beginPath();
    A.moveTo(X(0) + Math.cos(ang) * 0.45 * S, Y(0) + Math.sin(ang) * 0.45 * S);
    A.lineTo(X(0) + Math.cos(ang) * 0.55 * S, Y(0) + Math.sin(ang) * 0.55 * S);
    A.stroke();
  }
  A.fillStyle = paint;
  A.fillRect(X(0) - 0.012 * S, Y(-0.68) + 4, 0.024 * S, Y(0.68) - Y(-0.68) - 8);
  // start markers at ±2.6
  for (const sx of [-2.6, 2.6]) {
    A.fillStyle = 'rgba(206,214,224,0.24)';
    A.fillRect(X(sx) - 0.03 * S, Y(-0.3), 0.06 * S, 0.6 * S);
    A.fillRect(X(sx) - 0.16 * S, Y(-0.3), 0.32 * S, 0.04 * S);
    A.fillRect(X(sx) - 0.16 * S, Y(0.26), 0.32 * S, 0.04 * S);
  }
  // Stencil text near the back railing.
  A.fillStyle = 'rgba(214,220,228,0.26)';
  A.font = `bold ${Math.round(0.2 * S)}px Arial, Helvetica, sans-serif`;
  A.textBaseline = 'middle';
  A.fillText('GANTRY 07  //  REACTOR ACCESS', X(-6.4), Y(-1.78));
  A.fillText('MAX LOAD 4.0 T', X(3.9), Y(-1.78));
  D.fillStyle = dataRgb(0.5, 0.6, 0.3, 0.6);
  D.font = A.font;
  D.textBaseline = 'middle';
  D.fillText('GANTRY 07  //  REACTOR ACCESS', X(-6.4), Y(-1.78));
  D.fillText('MAX LOAD 4.0 T', X(3.9), Y(-1.78));

  // Per-pixel grime / variation pass.
  const grime = fbm(rng, 24, 6, 4);
  const fine = valueNoise(rng, 512, 128);
  const ai = A.getImageData(0, 0, W, H);
  const di = D.getImageData(0, 0, W, H);
  const ap = ai.data;
  const dp = di.data;
  for (let py = 0; py < H; py++) {
    const v = py / H;
    const z = DECK_TEX_Z0 + v * (DECK_TEX_Z1 - DECK_TEX_Z0);
    const edge = smooth(1.9, 2.5, Math.abs(z)); // grime collects at edges
    for (let px = 0; px < W; px++) {
      const u = px / W;
      const x = DECK_TEX_X0 + u * (DECK_TEX_X1 - DECK_TEX_X0);
      const wall = smooth(7.6, 9.2, Math.abs(x));
      const g = smooth(0.42, 0.78, grime(u, v));
      const f = fine(u, v) - 0.5;
      const dirt = clamp01(g * 0.55 + edge * 0.35 + wall * 0.4);
      const k = (1 - dirt * 0.42) * (1 + f * 0.1);
      const i = (py * W + px) * 4;
      ap[i] = ap[i] * k;
      ap[i + 1] = ap[i + 1] * k;
      ap[i + 2] = ap[i + 2] * (k * 0.98);
      dp[i + 1] = Math.min(255, dp[i + 1] + dirt * 60 + f * 14);
      dp[i + 2] = Math.max(0, dp[i + 2] - dirt * 40);
    }
  }
  A.putImageData(ai, 0, 0);
  D.putImageData(di, 0, 0);
  return { albedo: a.canvas, data: d.canvas };
}

// ---------------------------------------------------------------------------
// Tileable steel panel (used with world-space box UVs on every structure)
// ---------------------------------------------------------------------------

function buildPanel(rng: Rng): { albedo: HTMLCanvasElement; data: HTMLCanvasElement } {
  const N = 512;
  const half = N / 2;
  const a = canvas2d(N, N);
  const d = canvas2d(N, N);
  const A = a.ctx;
  const D = d.ctx;
  A.fillStyle = 'rgb(150,157,167)';
  A.fillRect(0, 0, N, N);
  D.fillStyle = dataRgb(0.5, 0.44, 0.85);
  D.fillRect(0, 0, N, N);

  // Plate tints.
  const plates: Array<[number, number, number, number]> = [
    [0, 0, half, half],
    [half, 0, half / 2, half],
    [half + half / 2, 0, half / 2, half],
    [0, half, half, half],
    [half, half, half, half],
  ];
  for (const [x, y, w, h] of plates) {
    const t = (rng() - 0.5) * 0.16;
    A.fillStyle = t > 0 ? `rgba(200,206,216,${t})` : `rgba(8,10,14,${-t})`;
    A.fillRect(x, y, w, h);
    D.fillStyle = dataRgb(0.5, 0.4 + rng() * 0.14, 0.85, 0.7);
    D.fillRect(x, y, w, h);
  }

  // Vent grille in the lower-left plate.
  for (let i = 0; i < 7; i++) {
    const y = half + 40 + i * 26;
    A.fillStyle = 'rgb(14,15,18)';
    A.fillRect(40, y, half - 80, 12);
    A.fillStyle = 'rgba(210,216,226,0.35)';
    A.fillRect(40, y + 12, half - 80, 2);
    D.fillStyle = dataRgb(0.04, 0.85, 0.5);
    D.fillRect(40, y, half - 80, 12);
    D.fillStyle = dataRgb(0.7, 0.36, 0.85);
    D.fillRect(40, y + 12, half - 80, 2);
  }
  // Painted ID patch in the lower-right plate.
  A.fillStyle = 'rgb(58,64,72)';
  A.fillRect(half + 36, half + 150, 120, 52);
  A.fillStyle = 'rgba(220,226,232,0.55)';
  for (let i = 0; i < 5; i++) A.fillRect(half + 46 + i * 20, half + 160, 10, 32);
  D.fillStyle = dataRgb(0.55, 0.62, 0.15);
  D.fillRect(half + 36, half + 150, 120, 52);

  // Seams (tile edges + internal), drawn so the tile wraps cleanly.
  const seamV = (x: number): void => {
    A.fillStyle = 'rgb(16,17,20)';
    A.fillRect(x - 2, 0, 4, N);
    D.fillStyle = dataRgb(0.06, 0.8, 0.55);
    D.fillRect(x - 2, 0, 4, N);
  };
  const seamHz = (y: number, x0 = 0, x1 = N): void => {
    A.fillStyle = 'rgb(16,17,20)';
    A.fillRect(x0, y - 2, x1 - x0, 4);
    D.fillStyle = dataRgb(0.06, 0.8, 0.55);
    D.fillRect(x0, y - 2, x1 - x0, 4);
  };
  seamV(0);
  seamV(N);
  seamV(half);
  // internal seam splitting the upper-right plate (top half only)
  A.fillStyle = 'rgb(16,17,20)';
  A.fillRect(half + half / 2 - 2, 0, 4, half);
  D.fillStyle = dataRgb(0.06, 0.8, 0.55);
  D.fillRect(half + half / 2 - 2, 0, 4, half);
  seamHz(0);
  seamHz(N);
  seamHz(half);

  // Bolts at plate corners.
  const bolt = (x: number, y: number): void => {
    A.fillStyle = 'rgba(10,12,16,0.6)';
    A.beginPath();
    A.arc(x + 1, y + 1, 5, 0, Math.PI * 2);
    A.fill();
    const g = A.createRadialGradient(x - 1.5, y - 1.5, 0.3, x, y, 4);
    g.addColorStop(0, 'rgb(220,226,234)');
    g.addColorStop(1, 'rgb(80,86,96)');
    A.fillStyle = g;
    A.beginPath();
    A.arc(x, y, 4, 0, Math.PI * 2);
    A.fill();
    D.fillStyle = dataRgb(0.97, 0.3, 0.9);
    D.beginPath();
    D.arc(x, y, 4, 0, Math.PI * 2);
    D.fill();
  };
  const boltRows = [14, half - 14, half + 14, N - 14];
  for (const y of boltRows) {
    for (let x = 14; x < N; x += 40.5) bolt(x, y);
  }

  // Grime streaks running down from bolts and vents (wrap vertically).
  for (let i = 0; i < 70; i++) {
    const x = rng() * N;
    const y0 = rng() * N;
    const len = 30 + rng() * 160;
    const alpha = 0.05 + rng() * 0.12;
    for (const off of [0, -N]) {
      const g = A.createLinearGradient(0, y0 + off, 0, y0 + off + len);
      g.addColorStop(0, `rgba(12,10,8,${alpha})`);
      g.addColorStop(1, 'rgba(12,10,8,0)');
      A.fillStyle = g;
      A.fillRect(x, y0 + off, 2 + rng() * 5, len);
    }
    D.fillStyle = dataRgb(0.5, 0.7, 0.7, alpha * 2);
    D.fillRect(x, y0, 3, len);
  }
  // Edge wear highlights along seams.
  A.fillStyle = 'rgba(214,220,230,0.2)';
  for (const y of [3, half + 3]) A.fillRect(0, y, N, 1.5);
  for (const x of [3, half + 3]) A.fillRect(x, 0, 1.5, N);

  // Per-pixel tileable noise.
  const grime = fbm(rng, 4, 4, 4);
  const fine = valueNoise(rng, 128, 128);
  const ai = A.getImageData(0, 0, N, N);
  const di = D.getImageData(0, 0, N, N);
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const u = px / N;
      const v = py / N;
      const g = smooth(0.4, 0.8, grime(u, v));
      const f = fine(u, v) - 0.5;
      const k = (1 - g * 0.38) * (1 + f * 0.12);
      const i = (py * N + px) * 4;
      ai.data[i] *= k;
      ai.data[i + 1] *= k;
      ai.data[i + 2] *= k;
      di.data[i + 1] = Math.min(255, di.data[i + 1] + g * 55 + f * 18);
    }
  }
  A.putImageData(ai, 0, 0);
  D.putImageData(di, 0, 0);
  return { albedo: a.canvas, data: d.canvas };
}

// ---------------------------------------------------------------------------
// Hazard stripes (tileable both ways)
// ---------------------------------------------------------------------------

function buildHazard(rng: Rng): HTMLCanvasElement {
  const N = 256;
  const { canvas, ctx } = canvas2d(N, N);
  ctx.fillStyle = 'rgb(24,24,26)';
  ctx.fillRect(0, 0, N, N);
  ctx.fillStyle = 'rgb(214,162,36)';
  const period = 64; // 0.4 world units with HAZARD_TILE = 1.6
  for (let k = -N; k < 2 * N; k += period) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + period / 2, 0);
    ctx.lineTo(k + period / 2 + N, N);
    ctx.lineTo(k + N, N);
    ctx.closePath();
    ctx.fill();
  }
  // Chips and scratches exposing steel; draw wrapped copies so the tile stays seamless.
  for (let i = 0; i < 160; i++) {
    const x = rng() * N;
    const y = rng() * N;
    const w = 2 + rng() * 12;
    const h = 1 + rng() * 2.5;
    ctx.fillStyle = `rgba(96,102,110,${0.3 + rng() * 0.5})`;
    for (const ox of [0, -N]) for (const oy of [0, -N]) ctx.fillRect(x + ox, y + oy, w, h);
  }
  const grime = fbm(rng, 4, 4, 3);
  const img = ctx.getImageData(0, 0, N, N);
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const k = 1 - smooth(0.45, 0.85, grime(px / N, py / N)) * 0.45;
      const i = (py * N + px) * 4;
      img.data[i] *= k;
      img.data[i + 1] *= k;
      img.data[i + 2] *= k;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// Stencil decals
// ---------------------------------------------------------------------------

function buildDecals(): HTMLCanvasElement {
  const W = 1024;
  const H = 512;
  const { canvas, ctx } = canvas2d(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const stencil = (text: string, cx: number, cy: number, size: number, bridges: number[]): void => {
    ctx.font = `900 ${size}px Impact, "Arial Black", Arial, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, cx, cy);
    // stencil bridges
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (const bx of bridges) ctx.fillRect(bx - 3, cy - size * 0.6, 6, size * 1.2);
    ctx.restore();
  };
  // canvas y down; atlas region v ranges are flipped (v=1 at canvas top)
  stencil('07', 128, 128, 200, [128 - 40, 128 + 40]);
  stencil('08', 384, 128, 200, [384 - 40, 384 + 40]);
  stencil('DANGER', 768, 64, 104, []);
  stencil('HIGH VOLTAGE', 768, 192, 70, []);
  ctx.font = '700 60px Arial, Helvetica, sans-serif';
  ctx.fillText('REACTOR GANTRY', 256, 320);
  // chevrons
  for (let i = 0; i < 5; i++) {
    const x = 40 + i * 90;
    ctx.beginPath();
    ctx.moveTo(x, 400);
    ctx.lineTo(x + 40, 400);
    ctx.lineTo(x + 80, 448);
    ctx.lineTo(x + 40, 496);
    ctx.lineTo(x, 496);
    ctx.lineTo(x + 40, 448);
    ctx.closePath();
    ctx.fill();
  }
  // warning triangle with bolt
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#ffffff';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(640, 280);
  ctx.lineTo(748, 480);
  ctx.lineTo(532, 480);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(650, 330);
  ctx.lineTo(612, 410);
  ctx.lineTo(644, 410);
  ctx.lineTo(626, 462);
  ctx.lineTo(672, 386);
  ctx.lineTo(640, 386);
  ctx.closePath();
  ctx.fill();
  // up arrow
  ctx.beginPath();
  ctx.moveTo(896, 280);
  ctx.lineTo(980, 380);
  ctx.lineTo(926, 380);
  ctx.lineTo(926, 490);
  ctx.lineTo(866, 490);
  ctx.lineTo(866, 380);
  ctx.lineTo(812, 380);
  ctx.closePath();
  ctx.fill();
  return canvas;
}

// ---------------------------------------------------------------------------
// Noise (for haze, shafts, plasma)
// ---------------------------------------------------------------------------

function buildNoise(rng: Rng): HTMLCanvasElement {
  const N = 256;
  const { canvas, ctx } = canvas2d(N, N);
  const low = fbm(rng, 4, 4, 5);
  const high = fbm(rng, 16, 16, 3);
  const streak = fbm(rng, 24, 2, 3);
  const img = ctx.createImageData(N, N);
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const u = px / N;
      const v = py / N;
      const i = (py * N + px) * 4;
      img.data[i] = Math.round(smooth(0.2, 0.8, low(u, v)) * 255);
      img.data[i + 1] = Math.round(smooth(0.25, 0.75, high(u, v)) * 255);
      img.data[i + 2] = Math.round(smooth(0.3, 0.7, streak(u, v)) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function createArenaTextures(rng: Rng, maxAnisotropy: number): ArenaTextures {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));
  const deck = buildDeck(rng);
  const panel = buildPanel(rng);
  return {
    deckAlbedo: finishTexture(deck.albedo, true, false, aniso),
    deckData: finishTexture(deck.data, false, false, aniso),
    panelAlbedo: finishTexture(panel.albedo, true, true, aniso),
    panelData: finishTexture(panel.data, false, true, aniso),
    hazard: finishTexture(buildHazard(rng), true, true, aniso),
    decals: finishTexture(buildDecals(), true, false, 4),
    noise: finishTexture(buildNoise(rng), false, true, 1),
  };
}
