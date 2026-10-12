import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { InputManager, type MenuAction } from '../core/Input';
import { Loop } from '../core/Loop';
import { animsFor } from '../render/anim';
import { FighterAnimator, type AnimFrame } from '../render/anim/Animator';
import { createArena, type ArenaHandle } from '../render/Arena';
import { CameraDirector } from '../render/CameraDirector';
import { lookFor, type CharacterLook } from '../render/characters';
import { PostFx } from '../render/PostFx';
import { PRESENT_YAW } from '../render/rig/dims';
import { characterModelsSettled, preloadCharacterModels } from '../render/characterModels';
import { FighterRig } from '../render/rig/FighterRig';
import { Weapon } from '../render/rig/weapons';
import { SaberTrail } from '../render/SaberTrail';
import { Vfx } from '../render/Vfx';
import { CpuController, type Difficulty } from '../sim/Ai';
import { METER_MAX, SIM_DT, SIM_HZ, SUPER_FREEZE } from '../sim/constants';
import type { Fighter } from '../sim/Fighter';
import { Match, type Projectile } from '../sim/Match';
import { ROSTER } from '../sim/roster';
import { CHARACTER_IDS, emptyInput, type CharacterId, type FighterId, type InputFrame, type SimEvent } from '../sim/types';
import { Ui, type Screen, type SelectView } from '../ui/Ui';
import { createSeededRandom } from '../utils/random';
import { HitboxDebug } from './HitboxDebug';

export type GameMode = 'attract' | 'select' | 'cpu' | 'versus';

/** Sith lightning reads blue-violet whatever the caster's palette. */
const LIGHTNING = new THREE.Color(0xa9b4ff);
const WHITE = new THREE.Color(1, 1, 1);

interface FighterView {
  id: FighterId;
  char: CharacterId;
  alt: boolean;
  look: CharacterLook;
  rig: FighterRig;
  animator: FighterAnimator;
  contact: THREE.Mesh;
  /** One trail per blade (staff ends / dual sabers). */
  trails: [SaberTrail, SaberTrail];
  base: [THREE.Vector3, THREE.Vector3];
  tip: [THREE.Vector3, THREE.Vector3];
  lastTip: [THREE.Vector3, THREE.Vector3];
  tipSpeed: number;
  bladeLit: boolean;
  color: THREE.Color;
  color2: THREE.Color;
  forceColor: THREE.Color;
  prevX: number;
  prevY: number;
  /** Thrown saberstaff visual (THANE only). */
  flyer: Weapon | null;
  flySpin: number;
  flyPrev: THREE.Vector3;
  hand: THREE.Vector3;
}

interface Scheduled {
  at: number;
  fn: () => void;
}

/** Soft dark blob that grounds a fighter on the deck (the key light throws real shadows behind them). */
function contactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode / previews) — settings just won't persist.
  }
}

function isCharacter(value: string | undefined): value is CharacterId {
  return value !== undefined && (CHARACTER_IDS as readonly string[]).includes(value);
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 260);
  private readonly director: CameraDirector;
  private readonly post: PostFx;
  private readonly arena: ArenaHandle;
  private readonly vfx: Vfx;
  private readonly input: InputManager;
  private readonly ui: Ui;
  private readonly audio: AudioEngine;
  private readonly debug: HitboxDebug | null;
  private readonly loop: Loop;
  private readonly match = new Match(['kael', 'vexa']);
  private readonly rigs = new Map<string, FighterRig>();
  private readonly flyers = new Map<string, Weapon>();
  private readonly views: [FighterView, FighterView];
  private readonly contactTexture = contactShadowTexture();
  private cpu: [CpuController, CpuController];
  private readonly inputs: [InputFrame, InputFrame] = [emptyInput(), emptyInput()];
  private readonly projPrev = new Map<Projectile, { x: number; y: number }>();

  private mode: GameMode = 'attract';
  /** What the select screen leads into. */
  private pendingMode: 'cpu' | 'versus' = 'cpu';
  private readonly sel: SelectView = { cursor: [0, 1], locked: [false, false], active: 0, versus: false };
  private selectOpenedAt = 0;
  private selectStarting = false;
  private picks: [CharacterId, CharacterId] = ['kael', 'vexa'];
  private difficulty: Difficulty = 'normal';
  private rng = createSeededRandom(1);
  private vfxRng = createSeededRandom(7);
  private accumulator = 0;
  private timeScale = 1;
  private slowmo = 0;
  private paused = false;
  private screenshotPaused = false;
  private reducedMotion = false;
  private frame = 0;
  private elapsed = 0;
  private ambientTime = 0;
  private uiTime = 0;
  private readonly schedule: Scheduled[] = [];
  private impact = 0;
  private superLevel = 0;
  private koFocus = 0;
  private koFocusX = 0;
  private beamOwner: FighterId | -1 = -1;
  private gripOwner: FighterId | -1 = -1;
  private quality: 'high' | 'low';
  private maxDpr: number;
  private readonly eventCounts: Record<string, number> = {};
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpV3 = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private readonly animFrame: AnimFrame;
  /** Dev-only close-up camera override for inspecting rigs (window.__SABER__.debugFocus). */
  debugFocus: { x: number; y: number; dist: number } | null = null;
  private lastWidth = 0;
  private lastHeight = 0;
  private lastDpr = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly app: HTMLElement) {
    // Realistic fighter models load in the background; rigs upgrade from the procedural body when ready.
    const modelsReady = preloadCharacterModels();
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.quality = coarse ? 'low' : 'high';
    this.maxDpr = this.quality === 'low' ? 1.5 : 2;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;

    this.director = new CameraDirector(this.camera);
    this.arena = createArena(this.scene, this.renderer, createSeededRandom(4242));
    this.arena.setQuality(this.quality);
    this.post = new PostFx(this.renderer, this.scene, this.camera);
    this.post.setQuality(this.quality);
    this.vfx = new Vfx(() => this.vfxRng());
    this.scene.add(this.vfx.group);

    const stick = this.el('#touch-stick');
    const knob = this.el('#touch-knob');
    const touchButtons = [...app.querySelectorAll<HTMLElement>('.touch-button')];
    this.input = new InputManager(stick, knob, touchButtons);
    this.ui = new Ui(app);
    this.audio = new AudioEngine(createSeededRandom(0xa0d10));
    this.debug = new URLSearchParams(window.location.search).has('debug') ? new HitboxDebug(this.scene) : null;

    this.views = [this.makeView(0, 'kael', false), this.makeView(1, 'vexa', false)];
    this.cpu = [
      new CpuController(this.match, 0, createSeededRandom(11), 'hard'),
      new CpuController(this.match, 1, createSeededRandom(12), 'normal'),
    ];
    this.animFrame = { match: this.match, alpha: 0, dt: 0, time: 0, timeScale: 1, reducedMotion: false };

    this.wireUi();
    this.restoreSettings();

    this.ui.setTouchMode(coarse);
    this.enterAttract();
    this.resize();
    // Hooks exist immediately (harnesses probe for them); state staging awaits the character models.
    this.modelsReady = modelsReady;
    this.installTestHooks();
    this.publishDiagnostics();
    if (import.meta.env.DEV) (window as unknown as { __SABER__: Game }).__SABER__ = this;

    this.loop = new Loop(
      (delta) => this.update(delta),
      () => this.render(),
    );
  }

  start(): void {
    this.loop.start();
  }

  // ---------------------------------------------------------------- setup

  private el(selector: string): HTMLElement {
    const el = this.app.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`Missing ${selector}`);
    return el;
  }

  private rigFor(char: CharacterId, alt: boolean): FighterRig {
    const key = `${char}:${alt ? 1 : 0}`;
    let rig = this.rigs.get(key);
    if (!rig) {
      rig = new FighterRig(lookFor(char, alt));
      rig.setShadows(this.quality === 'high');
      rig.root.visible = false;
      this.scene.add(rig.root);
      this.rigs.set(key, rig);
    }
    return rig;
  }

  private flyerFor(rig: FighterRig): Weapon | null {
    const look = rig.look;
    if (look.weapon.kind !== 'staff') return null;
    const key = `${look.id}:${look.weapon.blade}`;
    let w = this.flyers.get(key);
    if (!w) {
      w = new Weapon('staff', look.weapon.blade, look.weapon.blade2, look.weapon.hilt, rig.metal);
      w.main.visible = false;
      w.setExtension(1, 1);
      this.scene.add(w.main);
      this.flyers.set(key, w);
    }
    return w;
  }

  private makeView(id: FighterId, char: CharacterId, alt: boolean): FighterView {
    const rig = this.rigFor(char, alt);
    rig.root.visible = true;
    const look = rig.look;
    const color = new THREE.Color(look.weapon.blade);
    const color2 = new THREE.Color(look.weapon.blade2);
    const trails: [SaberTrail, SaberTrail] = [new SaberTrail(color), new SaberTrail(color2)];
    for (const t of trails) this.scene.add(t.mesh);
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1.25, 0.7),
      new THREE.MeshBasicMaterial({ map: this.contactTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.006;
    contact.renderOrder = 2;
    this.scene.add(contact);
    const animator = new FighterAnimator(this.match.fighters[id], animsFor(char));
    animator.footScale = look.scale * Math.cos(PRESENT_YAW);
    const view: FighterView = {
      id,
      char,
      alt,
      look,
      rig,
      animator,
      contact,
      trails,
      base: [new THREE.Vector3(), new THREE.Vector3()],
      tip: [new THREE.Vector3(), new THREE.Vector3()],
      lastTip: [new THREE.Vector3(), new THREE.Vector3()],
      tipSpeed: 0,
      bladeLit: false,
      color,
      color2,
      forceColor: new THREE.Color(look.force),
      prevX: 0,
      prevY: 0,
      flyer: this.flyerFor(rig),
      flySpin: 0,
      flyPrev: new THREE.Vector3(),
      hand: new THREE.Vector3(),
    };
    animator.onFootstep = (run) => this.footstep(view, run);
    this.audio.setHumStyle(id, char);
    return view;
  }

  /** Swap a view's rig + animation set (select screen, new match, attract rotation). */
  private setViewCharacter(v: FighterView, char: CharacterId, alt: boolean): void {
    if (v.char === char && v.alt === alt) return;
    const rig = this.rigFor(char, alt);
    v.rig = rig;
    v.look = rig.look;
    v.char = char;
    v.alt = alt;
    v.animator.setAnims(animsFor(char));
    v.animator.footScale = rig.look.scale * Math.cos(PRESENT_YAW);
    v.color.set(rig.look.weapon.blade);
    v.color2.set(rig.look.weapon.blade2);
    v.forceColor.set(rig.look.force);
    v.trails[0].setColor(v.color);
    v.trails[1].setColor(v.color2);
    v.trails[0].reset();
    v.trails[1].reset();
    v.flyer = this.flyerFor(rig);
    v.bladeLit = false;
    this.audio.setHumStyle(v.id, char);
  }

  /** Put the given duelists in the sim and on screen (P2 takes the alternate palette in a mirror). */
  private setCharacters(chars: [CharacterId, CharacterId]): void {
    this.match.setCharacters(chars);
    this.setViewCharacter(this.views[0], chars[0], false);
    this.setViewCharacter(this.views[1], chars[1], chars[0] === chars[1]);
    // Rigs are shared through the cache, so visibility is decided after both sides are assigned.
    for (const rig of this.rigs.values()) rig.root.visible = false;
    for (const w of this.flyers.values()) w.main.visible = false;
    for (const v of this.views) {
      v.rig.root.visible = true;
      v.animator.reset();
    }
  }

  private restoreSettings(): void {
    const d = readSetting('saber-duel:difficulty');
    if (d === 'easy' || d === 'normal' || d === 'hard') this.difficulty = d;
    this.ui.setDifficulty(this.difficulty);
    const muted = readSetting('saber-duel:muted') === '1';
    this.audio.setMuted(muted);
    this.ui.setSoundState(muted);
    const p0 = readSetting('saber-duel:p1');
    const p1 = readSetting('saber-duel:p2');
    if (isCharacter(p0 ?? undefined)) this.picks[0] = p0 as CharacterId;
    if (isCharacter(p1 ?? undefined)) this.picks[1] = p1 as CharacterId;
  }

  private wireUi(): void {
    this.ui.onAction = (action) => this.handleAction(action);
    this.ui.onDifficulty = (d) => {
      this.difficulty = d;
      writeSetting('saber-duel:difficulty', d);
    };
    this.ui.onSound = () => this.toggleMute();
    this.ui.onUiSound = (kind) => {
      if (kind === 'move') this.audio.uiMove();
      else if (kind === 'select') this.audio.uiSelect();
      else this.audio.uiBack();
    };
    this.ui.onPick = (index) => this.pickCard(index);
    this.input.onAnyInput = () => {
      if (!this.audio.unlocked) {
        void this.audio.unlock().then(() => this.audio.setAmbience(true));
      }
    };
    this.input.onMenu = (action, source, player) => this.handleMenu(action, source, player);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) this.toggleMute();
    });
    window.addEventListener('pointerdown', () => {
      if (!this.audio.unlocked) void this.audio.unlock().then(() => this.audio.setAmbience(true));
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.ui.current === 'fight') this.pause();
        this.audio.suspend();
      } else {
        this.audio.resume();
      }
    });
    window.addEventListener('resize', () => this.resize());
    // Clicking away mid-fight pauses instead of leaving the CPU swinging at an idle player.
    window.addEventListener('blur', () => {
      if (this.ui.current === 'fight' && !this.screenshotPaused) this.pause();
    });
  }

  private toggleMute(): void {
    const muted = !this.audio.isMuted();
    this.audio.setMuted(muted);
    this.ui.setSoundState(muted);
    writeSetting('saber-duel:muted', muted ? '1' : '0');
  }

  private handleMenu(action: MenuAction, source: 'key' | 'pad', player: 0 | 1): boolean {
    if (source === 'pad') this.ui.setTouchMode(false);
    const screen = this.ui.current;
    if (screen === 'fight') {
      if (action === 'pause') this.pause();
      return action === 'pause';
    }
    if (screen === 'select') return this.selectMenu(action, player);
    return this.ui.navigate(action);
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'cpu':
        this.openSelect('cpu');
        break;
      case 'versus':
        this.openSelect('versus');
        break;
      case 'select':
        this.openSelect(this.mode === 'versus' ? 'versus' : 'cpu');
        break;
      case 'controls':
        this.ui.setScreen('controls');
        break;
      case 'back':
        if (this.ui.current === 'select') this.selectMenu('back', 0);
        else this.ui.setScreen(this.ui.controlsReturn === 'pause' ? 'pause' : 'title');
        break;
      case 'pause':
        this.pause();
        break;
      case 'resume':
        this.resume();
        break;
      case 'restart':
      case 'rematch':
        this.startMatch(this.mode === 'versus' ? 'versus' : 'cpu');
        break;
      case 'quit':
        this.enterAttract();
        break;
    }
  }

  // ---------------------------------------------------------- select screen

  private openSelect(mode: 'cpu' | 'versus'): void {
    this.mode = 'select';
    this.pendingMode = mode;
    this.paused = false;
    this.audio.setPaused(false);
    this.resetVisuals();
    const s = this.sel;
    s.versus = mode === 'versus';
    s.active = s.versus ? 'both' : 0;
    s.locked[0] = false;
    s.locked[1] = false;
    s.cursor[0] = CHARACTER_IDS.indexOf(this.picks[0]);
    s.cursor[1] = CHARACTER_IDS.indexOf(this.picks[1]);
    this.selectStarting = false;
    this.selectOpenedAt = this.uiTime;
    this.applySelectPreview(true);
    this.views[0].animator.showcase('intro');
    this.views[1].animator.showcase('intro');
    this.ui.updateSelect(s);
    this.ui.setScreen('select');
    this.audio.setIntensity(0.1);
  }

  /** The two hovered duelists stand in the arena behind the cards. */
  private applySelectPreview(force: boolean): void {
    const a = CHARACTER_IDS[this.sel.cursor[0]];
    const b = CHARACTER_IDS[this.sel.cursor[1]];
    const [fa, fb] = this.match.fighters;
    if (!force && fa.def.id === a && fb.def.id === b && this.views[1].alt === (a === b)) return;
    const shows = this.views.map((v) => v.animator.showcasing);
    this.setCharacters([a, b]);
    this.match.skipIntro();
    this.match.events.length = 0;
    fa.x = -1.45;
    fb.x = 1.45;
    this.syncViewsToSim();
    this.views.forEach((v, i) => {
      if (shows[i]) v.animator.showcase(shows[i] as 'intro');
    });
    this.director.snap(fa.x, fb.x);
  }

  private selectSide(player: 0 | 1): 0 | 1 {
    const s = this.sel;
    if (s.versus) return player;
    return s.active === 1 ? 1 : 0;
  }

  private selectMenu(action: MenuAction, player: 0 | 1): boolean {
    const s = this.sel;
    if (this.selectStarting) return true;
    const side = this.selectSide(player);
    switch (action) {
      case 'left':
      case 'right':
      case 'up':
      case 'down': {
        if (s.locked[side]) return true;
        const step = action === 'left' || action === 'up' ? -1 : 1;
        s.cursor[side] = (s.cursor[side] + step + CHARACTER_IDS.length) % CHARACTER_IDS.length;
        this.audio.characterSelect(s.cursor[side]);
        this.applySelectPreview(false);
        this.views[side].animator.showcase('intro');
        this.ui.updateSelect(s);
        return true;
      }
      case 'confirm':
        if (this.uiTime - this.selectOpenedAt < 0.35) return true;
        if (!s.locked[side]) this.lockPick(side);
        return true;
      case 'back':
      case 'pause':
        if (s.locked[side] && (s.versus || side === 1)) {
          s.locked[side] = false;
          this.audio.uiBack();
        } else if (!s.versus && side === 1) {
          s.active = 0;
          s.locked[0] = false;
          this.audio.uiBack();
        } else {
          this.audio.uiBack();
          this.enterAttract();
          return true;
        }
        this.ui.updateSelect(s);
        return true;
      default:
        return false;
    }
  }

  /** Mouse/touch pick on a card. */
  private pickCard(index: number): void {
    if (this.ui.current !== 'select' || this.selectStarting) return;
    const s = this.sel;
    const side: 0 | 1 = s.versus ? (s.locked[0] ? 1 : 0) : s.active === 1 ? 1 : 0;
    if (s.locked[side]) return;
    if (s.cursor[side] !== index) {
      s.cursor[side] = index;
      this.applySelectPreview(false);
    }
    this.lockPick(side);
  }

  private lockPick(side: 0 | 1): void {
    const s = this.sel;
    s.locked[side] = true;
    this.audio.uiSelect();
    this.audio.characterSelect(s.cursor[side]);
    this.views[side].animator.showcase('heavy');
    const id = CHARACTER_IDS[s.cursor[side]];
    this.ui.callout(side, ROSTER[id].name, 'READY', 'info');
    if (!s.versus && side === 0) {
      s.active = 1;
      if (s.cursor[1] === s.cursor[0]) {
        s.cursor[1] = (s.cursor[0] + 1) % CHARACTER_IDS.length;
        this.applySelectPreview(false);
      }
      this.views[1].animator.showcase('intro');
    }
    this.ui.updateSelect(s);
    if (s.locked[0] && s.locked[1]) {
      this.selectStarting = true;
      this.picks = [CHARACTER_IDS[s.cursor[0]], CHARACTER_IDS[s.cursor[1]]];
      writeSetting('saber-duel:p1', this.picks[0]);
      writeSetting('saber-duel:p2', this.picks[1]);
      this.audio.versus();
      this.ui.flash('rgba(255,235,200,0.7)', 0.2, 140);
      this.at(1.0, () => {
        if (this.mode === 'select') this.startMatch(this.pendingMode);
      });
    }
  }

  // ---------------------------------------------------------------- modes

  private resetVisuals(): void {
    this.vfx.clear();
    for (const v of this.views) {
      v.trails[0].reset();
      v.trails[1].reset();
      v.bladeLit = false;
      if (v.flyer) v.flyer.main.visible = false;
      v.rig.weapon.setVisible(true);
      v.animator.reset();
    }
    this.vfx.setBeam(false, this.tmpV, this.tmpV, this.tmpV, LIGHTNING);
    this.audio.setGrip(false, 0);
    this.audio.setLightning(false, 0);
    this.audio.setSpinningBlade(false, 0, 0);
    this.beamOwner = -1;
    this.gripOwner = -1;
    this.projPrev.clear();
    this.schedule.length = 0;
    this.slowmo = 0;
    this.timeScale = 1;
    this.superLevel = 0;
    this.koFocus = 0;
    this.impact = 0;
    this.accumulator = 0;
    this.ui.clearAnnouncer();
    this.ui.resetHud();
    this.ui.setSuperOverlay(0, '#000');
  }

  private syncViewsToSim(): void {
    this.match.fighters.forEach((f, i) => {
      const v = this.views[i];
      v.prevX = f.x;
      v.prevY = f.y;
    });
  }

  private randomPair(): [CharacterId, CharacterId] {
    const n = CHARACTER_IDS.length;
    const a = Math.floor(this.rng() * n) % n;
    let b = Math.floor(this.rng() * (n - 1)) % (n - 1);
    if (b >= a) b += 1;
    return [CHARACTER_IDS[a], CHARACTER_IDS[b]];
  }

  enterAttract(): void {
    this.mode = 'attract';
    this.paused = false;
    this.audio.setPaused(false);
    this.resetVisuals();
    this.setCharacters(this.randomPair());
    this.cpu[0].reset();
    this.cpu[1].reset();
    this.cpu[0].setDifficulty('hard');
    this.cpu[1].setDifficulty('hard');
    this.match.events.length = 0;
    this.syncViewsToSim();
    this.director.snap(this.match.fighters[0].x, this.match.fighters[1].x);
    this.ui.setScreen('title');
    this.audio.setIntensity(0);
  }

  startMatch(mode: 'cpu' | 'versus', chars: [CharacterId, CharacterId] = this.picks): void {
    // Fights wait for the fighter models (title/select stay interactive while they load).
    if (!characterModelsSettled()) {
      this.ui.announce('LOADING', '', 'round', 900);
      void preloadCharacterModels().then(() => this.startMatch(mode, chars));
      return;
    }
    this.mode = mode;
    this.picks = [chars[0], chars[1]];
    this.paused = false;
    this.audio.setPaused(false);
    this.resetVisuals();
    this.setCharacters(this.picks);
    this.cpu[0].reset();
    this.cpu[1].reset();
    this.cpu[1].setDifficulty(this.difficulty);
    this.syncViewsToSim();
    const [a, b] = this.views;
    this.ui.setNames(ROSTER[a.char].name, ROSTER[b.char].name, a.look.ui, b.look.ui);
    this.input.suppressHeld();
    this.ui.setScreen('fight');
    this.director.snap(this.match.fighters[0].x, this.match.fighters[1].x);
  }

  private pause(): void {
    if (this.ui.current !== 'fight' || this.mode === 'attract') return;
    this.paused = true;
    this.audio.setPaused(true);
    this.audio.setGrip(false, 0);
    this.audio.setLightning(false, 0);
    this.audio.setSpinningBlade(false, 0, 0);
    this.ui.setScreen('pause');
  }

  private resume(): void {
    this.input.suppressHeld();
    this.paused = false;
    this.audio.setPaused(false);
    this.ui.setScreen('fight');
  }

  // ---------------------------------------------------------------- loop

  private update(delta: number): void {
    this.frame += 1;
    this.input.pollMenuPads();
    this.resize();
    const frozenScreen = this.paused || this.screenshotPaused;
    const dt = frozenScreen ? 0 : delta;
    this.elapsed += dt;
    this.uiTime += frozenScreen ? 0 : delta;
    if (!this.reducedMotion) this.ambientTime += dt;

    // Scheduled UI beats (announcer follow-ups, result screen, select → fight).
    for (let i = this.schedule.length - 1; i >= 0; i -= 1) {
      if (this.uiTime >= this.schedule[i].at) {
        const item = this.schedule[i];
        this.schedule.splice(i, 1);
        item.fn();
      }
    }

    // KO slow motion.
    if (this.slowmo > 0) {
      this.slowmo = Math.max(0, this.slowmo - dt);
      this.timeScale = this.slowmo > 0.35 ? 0.3 : 0.3 + (1 - this.slowmo / 0.35) * 0.7;
    } else {
      this.timeScale = 1;
    }

    // The select screen poses the previews without running the fight.
    if (!frozenScreen && this.mode !== 'select') {
      this.accumulator += dt * this.timeScale;
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < 5) {
        this.stepSim();
        this.accumulator -= SIM_DT;
        steps += 1;
      }
      if (steps === 5) this.accumulator = 0;
    }

    const alpha = this.match.frozen || frozenScreen || this.mode === 'select' ? 0 : this.accumulator / SIM_DT;
    this.updateViews(dt, alpha);
    this.updateCamera(dt);

    this.vfx.update(dt, this.camera, this.pointScale());
    this.arena.update(dt, this.ambientTime);
    this.impact = Math.max(0, this.impact - dt * 4);
    this.post.update(this.ambientTime, this.impact, this.superLevel * 0.85, !this.reducedMotion);
    if (this.mode === 'cpu' || this.mode === 'versus') this.ui.updateHud(this.match, dt);
    this.updateAudio();
    this.debug?.update(this.match);
    this.publishDiagnostics();
  }

  private render(): void {
    this.renderer.info.reset();
    this.post.render();
  }

  private snapshotPrev(): void {
    for (let i = 0; i < 2; i += 1) {
      const v = this.views[i];
      v.prevX = this.match.fighters[i].x;
      v.prevY = this.match.fighters[i].y;
    }
    for (const p of this.match.projectiles) {
      const prev = this.projPrev.get(p);
      if (prev) {
        prev.x = p.x;
        prev.y = p.y;
      } else this.projPrev.set(p, { x: p.x, y: p.y });
    }
  }

  private stepSim(): void {
    const humans = this.mode === 'cpu' ? 1 : this.mode === 'versus' ? 2 : 0;
    this.snapshotPrev();
    // CPU controllers must observe every frame even when a human drives that side.
    const cpu0 = this.cpu[0].update();
    const cpu1 = this.cpu[1].update();
    if (humans >= 1) this.input.sample(0, this.mode === 'cpu', this.inputs[0]);
    else Object.assign(this.inputs[0], cpu0);
    if (humans >= 2) this.input.sample(1, false, this.inputs[1]);
    else Object.assign(this.inputs[1], cpu1);

    this.match.step(this.inputs[0], this.inputs[1]);
    for (const event of this.match.events) this.handleEvent(event);
    this.match.events.length = 0;
    if (this.projPrev.size > this.match.projectiles.length) {
      for (const p of this.projPrev.keys()) if (!this.match.projectiles.includes(p)) this.projPrev.delete(p);
    }

    if (this.mode === 'attract' && this.match.phase === 'matchOver' && this.match.phaseFrame > 150) {
      this.resetVisuals();
      this.setCharacters(this.randomPair());
      this.cpu[0].reset();
      this.cpu[1].reset();
      this.match.events.length = 0;
      this.syncViewsToSim();
    }
  }

  // ---------------------------------------------------------------- events

  private sideName(id: FighterId | -1): string {
    return id === -1 ? 'DRAW' : ROSTER[this.views[id].char].name;
  }

  private at(delay: number, fn: () => void): void {
    this.schedule.push({ at: this.uiTime + delay, fn });
  }

  private footstep(v: FighterView, run: boolean): void {
    if (this.mode !== 'cpu' && this.mode !== 'versus') return;
    const f = this.match.fighters[v.id];
    if (run) {
      this.audio.runStep(f.x);
      if (!this.reducedMotion) this.vfx.dust(this.tmpV3.set(f.x - f.facing * 0.2, 0, 0), 2, 0.25, -f.facing * 0.8);
    } else {
      this.audio.step(f.x);
    }
  }

  private handleEvent(e: SimEvent): void {
    this.eventCounts[e.type] = (this.eventCounts[e.type] ?? 0) + 1;
    const live = this.mode === 'cpu' || this.mode === 'versus';
    const p = this.tmpV;
    switch (e.type) {
      case 'hit': {
        const attacker = this.views[e.attacker];
        const defenderId: FighterId = e.attacker === 0 ? 1 : 0;
        const defender = this.views[defenderId];
        const df = this.match.fighters[defenderId];
        const af = this.match.fighters[e.attacker];
        p.set(e.x, e.y, 0.28);
        const s = e.strength;
        const forceHit = e.source === 'special' && (af.def.special === 'wave' || af.def.special === 'grip');
        const lightning = e.source === 'super' && af.def.superKind === 'lightning';
        const throwHit = e.source === 'throw';
        const height = THREE.MathUtils.clamp((e.y - df.y) / (1.85 * df.def.height), 0, 1);
        if (e.blocked) {
          defender.animator.blockReaction(s);
          if (lightning) {
            this.vfx.glowBurst(p, LIGHTNING, 8, 3, 0.08, 0.3);
            this.vfx.sparkBurst(p, defender.color, 8, 4, 0, 0.5);
          } else {
            this.vfx.sparkBurst(p, attacker.color, 16 + Math.round(18 * s), 5 + 5 * s, 0, 0.5);
            this.vfx.sparkBurst(p, defender.color, 10, 4, 0, 0.5);
            this.vfx.flash(p, 0xffffff, 0.55 + s * 0.4, 0.09, 1.3);
          }
          attacker.rig.weapon.pulse(0.6);
          defender.rig.weapon.pulse(0.6);
          this.director.addTrauma(0.1 + 0.15 * s);
          if (live) {
            if (lightning) this.audio.lightningHit(e.x);
            else this.audio.block(e.x);
          }
        } else {
          defender.animator.hitReaction(s, height);
          const color = lightning ? LIGHTNING : forceHit ? attacker.forceColor : attacker.color;
          if (!throwHit) {
            this.vfx.sparkBurst(p, color, 18 + Math.round(34 * s), 4 + 7 * s, e.attacker === 0 ? 0.6 : -0.6);
            this.vfx.glowBurst(p, color, 8 + Math.round(10 * s), 2.2, 0.1, 0.45, 0.6);
          }
          this.vfx.flash(p, this.tmpColor.copy(color).lerp(WHITE, 0.5), 0.8 + s * 1.1, 0.12 + s * 0.06, 1.8);
          if (s > 0.6 || e.counter) this.vfx.ring(p, color, 1.0 + s, 0.3, 1.2);
          this.director.addTrauma(0.18 + 0.38 * s);
          if (s > 0.6) {
            this.director.punch(1.6 * s);
            this.impact = Math.min(1, this.impact + s * 0.8);
          }
          if (live) {
            if (throwHit) this.audio.throwHit(e.x);
            else if (lightning) this.audio.lightningHit(e.x);
            else if (forceHit) this.audio.forceImpact(e.x);
            else this.audio.hit(s, e.x);
            if (e.counter) this.ui.callout(e.attacker, 'COUNTER', 'HIT', 'counter');
            else if (e.combo >= 2) this.ui.callout(e.attacker, String(e.combo), 'HIT COMBO', 'combo');
            else if (throwHit) this.ui.callout(e.attacker, 'THROW', '', 'info');
            if (s > 0.75) this.ui.flash('rgba(255,120,90,0.9)', 0.12, 110);
          }
        }
        break;
      }
      case 'parry': {
        p.set(e.x, e.y, 0.3);
        const v = this.views[e.defender];
        const f = this.match.fighters[e.defender];
        this.vfx.flash(p, 0xffffff, 2.6, 0.16, 2.1);
        this.vfx.ring(p, v.color, 1.9, 0.34, 1.6);
        this.vfx.ring(p, 0xffffff, 1.0, 0.2, 1.5);
        this.vfx.sparkBurst(p, v.color, 38, 8, f.facing * 0.5, 0.6);
        this.vfx.sparkBurst(p, 0xffffff, 16, 6, 0, 0.4);
        v.rig.weapon.pulse(1);
        v.animator.blockReaction(0.6);
        this.director.addTrauma(0.32);
        this.director.punch(1.8);
        this.impact = Math.min(1, this.impact + 0.55);
        if (live) {
          this.audio.parry(e.x);
          this.ui.callout(e.defender, 'PARRY', e.projectile ? 'DEFLECTED' : '', 'parry');
          this.ui.flash('rgba(205,235,255,0.9)', 0.2, 120);
        }
        break;
      }
      case 'parried': {
        const f = this.match.fighters[e.fighter];
        this.views[e.fighter].animator.hitReaction(0.55, 0.8);
        if (live) this.audio.parried(f.x);
        break;
      }
      case 'clash': {
        p.set(e.x, e.y, 0.3);
        this.vfx.sparkBurst(p, this.views[0].color, 40, 9);
        this.vfx.sparkBurst(p, this.views[1].color, 40, 9);
        this.vfx.flash(p, 0xffffff, 2.6, 0.2, 2.2);
        this.vfx.ring(p, 0xffffff, 2.4, 0.42, 1.4);
        this.vfx.lightning(p, this.views[0].color, this.views[1].color, 0.38);
        this.views[0].rig.weapon.pulse(1);
        this.views[1].rig.weapon.pulse(1);
        this.views[0].animator.blockReaction(1);
        this.views[1].animator.blockReaction(1);
        this.director.addTrauma(0.55);
        this.director.punch(2.5);
        this.impact = 1;
        if (live) {
          this.audio.clash(e.x);
          this.ui.flash('rgba(220,235,255,0.95)', 0.28, 160);
          this.ui.callout(0, 'CLASH', '', 'clash');
          this.ui.callout(1, 'CLASH', '', 'clash');
        }
        break;
      }
      case 'swing': {
        const f = this.match.fighters[e.fighter];
        this.views[e.fighter].animator.swung(e.strength);
        if (live) this.audio.swing(e.fighter, e.strength, f.x);
        break;
      }
      case 'jump': {
        const f = this.match.fighters[e.fighter];
        this.vfx.dust(p.set(f.x, 0, 0), f.runJump ? 9 : 5, 0.5, f.runJump ? -f.facing * 1.4 : 0);
        if (live) {
          this.audio.jump(f.x);
          if (e.flip) this.audio.flip(f.x);
        }
        break;
      }
      case 'land': {
        const f = this.match.fighters[e.fighter];
        this.views[e.fighter].animator.landed(f.runJump ? 1.4 : 1);
        this.vfx.dust(p.set(f.x, 0, 0), 7, 0.6);
        if (live) this.audio.land(f.x);
        break;
      }
      case 'run': {
        const f = this.match.fighters[e.fighter];
        this.vfx.dust(p.set(f.x - f.facing * 0.2, 0, 0), 8, 0.5, -f.facing * 1.6);
        if (live) this.audio.dash(f.x);
        break;
      }
      case 'runStep':
        break;
      case 'skid': {
        const f = this.match.fighters[e.fighter];
        this.vfx.dust(p.set(f.x + f.facing * 0.25, 0, 0), 10, 0.6, f.facing * 1.2);
        if (live) this.audio.skid(f.x);
        break;
      }
      case 'dash': {
        const f = this.match.fighters[e.fighter];
        this.vfx.dust(p.set(f.x, 0, 0), 8, 0.5, (e.back ? 1 : -1) * f.facing * 1.5);
        if (live) this.audio.dash(f.x);
        break;
      }
      case 'specialStart': {
        const f = this.match.fighters[e.fighter];
        if (live && (f.def.special === 'wave' || f.def.special === 'grip')) this.audio.forceCharge(f.x);
        break;
      }
      case 'leap': {
        const f = this.match.fighters[e.fighter];
        this.vfx.dust(p.set(f.x, 0, 0), 10, 0.6, -f.facing * 1.2);
        this.views[e.fighter].rig.weapon.pulse(0.6);
        if (live) {
          this.audio.leap(f.x);
          this.audio.flip(f.x);
        }
        break;
      }
      case 'projectile': {
        p.set(e.x, e.y, 0.1);
        const v = this.views[e.fighter];
        if (e.kind === 'staff') {
          this.vfx.sparkBurst(p, v.color, 12, 4);
          this.director.addTrauma(0.1);
          if (live) this.audio.staffThrow(e.x);
        } else {
          this.vfx.ring(p, v.forceColor, 0.9, 0.3, 1.2);
          this.vfx.glowBurst(p, v.forceColor, 14, 2.5, 0.12, 0.4);
          this.director.addTrauma(0.15);
          if (live) this.audio.forcePush(e.x);
        }
        break;
      }
      case 'staffCatch': {
        const v = this.views[e.fighter];
        v.rig.weapon.pulse(0.8);
        v.rig.swordHandWorld(this.tmpV2);
        this.vfx.sparkBurst(this.tmpV2, v.color, 10, 3);
        if (live) this.audio.staffCatch(this.match.fighters[e.fighter].x);
        break;
      }
      case 'projectileClash': {
        p.set(e.x, e.y, 0.1);
        this.vfx.ring(p, this.views[0].forceColor, 2.2, 0.45, 1.4);
        this.vfx.ring(p, this.views[1].forceColor, 1.6, 0.35, 1.4);
        this.vfx.flash(p, 0xffffff, 2.2, 0.18, 1.8);
        this.vfx.glowBurst(p, this.views[0].forceColor, 20, 4, 0.14, 0.5);
        this.vfx.glowBurst(p, this.views[1].forceColor, 20, 4, 0.14, 0.5);
        this.director.addTrauma(0.4);
        if (live) this.audio.forceImpact(e.x);
        break;
      }
      case 'deflect': {
        p.set(e.x, e.y, 0.25);
        const v = this.views[e.fighter];
        this.vfx.sparkBurst(p, v.color, 30, 7);
        this.vfx.flash(p, 0xffffff, 1.6, 0.14, 1.6);
        this.vfx.ring(p, this.views[e.fighter === 0 ? 1 : 0].forceColor, 1.6, 0.3, 1.2);
        this.director.addTrauma(0.3);
        if (live) {
          this.audio.block(e.x);
          this.audio.forceImpact(e.x);
          this.ui.callout(e.fighter, 'DEFLECT', '', 'info');
        }
        break;
      }
      case 'grip': {
        const f = this.match.fighters[e.fighter];
        const v = this.views[e.fighter];
        const victim = this.views[e.fighter === 0 ? 1 : 0];
        victim.rig.neckWorld(this.tmpV2);
        this.vfx.ring(this.tmpV2, v.forceColor, 1.2, 0.3, 1.3);
        this.vfx.glowBurst(this.tmpV2, v.forceColor, 14, 1.5, 0.1, 0.5, 0.4);
        this.director.addTrauma(0.2);
        if (live) {
          this.audio.gripStart(f.x);
          this.ui.callout(e.fighter, 'FORCE', 'GRIP', 'info');
        }
        break;
      }
      case 'gripTick': {
        const v = this.views[e.fighter];
        const victim = this.views[e.fighter === 0 ? 1 : 0];
        victim.rig.neckWorld(this.tmpV2);
        this.vfx.glowBurst(this.tmpV2, v.forceColor, 4, 1.2, 0.08, 0.35, 0.3);
        victim.animator.hitReaction(0.15, 0.9);
        this.director.addTrauma(0.05);
        break;
      }
      case 'throw':
        break;
      case 'throwTech': {
        p.set(e.x, e.y, 0.25);
        this.vfx.flash(p, 0xffffff, 1.2, 0.12, 1.4);
        this.vfx.sparkBurst(p, 0xffffff, 14, 4);
        if (live) {
          this.audio.block(e.x);
          this.ui.callout(0, 'BREAK', 'THROW', 'info');
          this.ui.callout(1, 'BREAK', 'THROW', 'info');
        }
        break;
      }
      case 'bounce': {
        this.views[e.fighter].animator.bounced();
        this.vfx.dust(p.set(e.x, 0, 0), 12, 1.0);
        this.director.addTrauma(0.22);
        if (live) this.audio.bodyBounce(e.x);
        break;
      }
      case 'knockdown': {
        const f = this.match.fighters[e.fighter];
        this.vfx.dust(p.set(e.x, 0, 0), 16, 1.4, f.slide * 6);
        this.director.addTrauma(0.25);
        if (live) {
          this.audio.knockdown(e.x);
          if (Math.abs(f.slide) > 0.01) this.audio.slide(e.x);
        }
        break;
      }
      case 'superFlash': {
        const v = this.views[e.fighter];
        const f = this.match.fighters[e.fighter];
        this.vfx.flash(this.tmpV2.set(f.x, 1.4, 0.4), v.color, 3.2, 0.5, 1.6);
        this.vfx.ring(this.tmpV2, v.color, 3.0, 0.6, 1.4);
        if (live) {
          this.audio.superFlash();
          this.ui.flash(`#${v.color.getHexString()}`, 0.45, 220);
          const [first, ...rest] = f.def.superName.toUpperCase().split(' ');
          this.ui.callout(e.fighter, first, rest.join(' '), 'counter');
        }
        break;
      }
      case 'noMeter':
        if (live) {
          this.ui.meterDenied(e.fighter);
          this.audio.uiBack();
        }
        break;
      case 'roundIntro':
        if (live) {
          const label = e.finalRound ? 'FINAL ROUND' : `ROUND ${e.round}`;
          this.at(0.15, () => this.ui.announce(label, '', 'round', 1050));
          this.audio.roundStart(e.round);
          this.audio.setIntensity(0.25 + (e.round - 1) * 0.15);
        }
        break;
      case 'fight':
        if (live) {
          this.ui.announce('FIGHT!', '', 'fight', 800);
          this.ui.flash('rgba(255,190,120,0.8)', 0.18, 140);
          this.audio.fight();
        }
        break;
      case 'ko': {
        this.slowmo = 1.5;
        const loser = e.loser === -1 ? 1 : e.loser;
        this.koFocusX = this.match.fighters[loser].x;
        this.koFocus = 1;
        this.director.addTrauma(0.6);
        this.impact = 1;
        if (live) {
          this.audio.ko();
          this.audio.setIntensity(0);
          this.ui.flash('rgba(255,255,255,1)', 0.55, 260);
          this.ui.announce(e.loser === -1 ? 'DOUBLE K.O.' : 'K.O.', '', 'ko', 1500);
        }
        break;
      }
      case 'roundEnd': {
        if (!live) break;
        const delay = e.reason === 'time' ? 0 : 1.6;
        if (e.reason === 'time') {
          this.ui.announce('TIME', '', 'time', 1200);
          this.audio.setIntensity(0);
        }
        this.at(delay + (e.reason === 'time' ? 1.3 : 0), () => {
          const text = e.winner === -1 ? 'DRAW' : `${this.sideName(e.winner)} WINS`;
          this.ui.announce(text, e.perfect ? 'PERFECT' : '', 'win', 1500);
          if (e.winner !== -1) this.audio.victory();
        });
        break;
      }
      case 'matchEnd': {
        if (!live) break;
        this.at(0.6, () => this.showResult(e.winner));
        break;
      }
      case 'timeWarning':
        if (live) this.audio.timeWarning();
        break;
    }
  }

  private showResult(winner: FighterId | -1): void {
    const [a, b] = this.match.fighters;
    const title = winner === -1 ? 'DRAW GAME' : `${this.sideName(winner)} WINS`;
    let kicker = 'MATCH OVER';
    if (this.mode === 'cpu') kicker = winner === 0 ? `VICTORY · CPU ${this.difficulty.toUpperCase()}` : winner === 1 ? 'DEFEAT' : 'MATCH OVER';
    const stats = (f: Fighter) => ({
      name: f.def.name,
      damage: f.stats.damageDealt,
      maxCombo: f.stats.maxCombo,
      clashes: f.stats.clashes,
      supers: f.stats.supers,
      parries: f.stats.parries,
      rounds: f.roundsWon,
    });
    this.ui.showResult(title, kicker, [stats(a), stats(b)]);
    this.ui.setScreen('result');
  }

  // ---------------------------------------------------------------- views

  private updateViews(dt: number, alpha: number): void {
    const m = this.match;
    const fr = this.animFrame;
    fr.alpha = alpha;
    fr.dt = dt;
    fr.time = this.ambientTime;
    fr.timeScale = this.timeScale;
    fr.reducedMotion = this.reducedMotion;
    this.beamOwner = -1;
    this.gripOwner = -1;
    // Force lightning (VEXA super): both hands pour bolts into the opponent.
    for (const f of m.fighters) {
      if (f.state === 'attack' && f.move?.id === 'super' && f.def.superKind === 'lightning' && m.superFreeze === 0 && f.stateFrame >= 11 && f.stateFrame <= 59) {
        this.beamOwner = f.id;
      }
    }

    m.fighters.forEach((f, i) => {
      const v = this.views[i];
      let x = v.prevX + (f.x - v.prevX) * alpha;
      const y = v.prevY + (f.y - v.prevY) * alpha;
      const pose = v.animator.update(fr, x);

      // Hitstop shudder on whoever just got hit.
      if (m.hitstop > 0 && f.flash > 0 && !this.reducedMotion) x += Math.sin(this.frame * 2.7) * 0.035;
      const rig = v.rig;
      rig.applyPose(pose, x, y, f.facing, v.animator.sec, this.ambientTime);
      rig.setExpression(v.animator.expression);
      const lift = Math.min(1, y / 2.2);
      const lying = f.state === 'knockdown' || f.state === 'ko' || (f.state === 'getup' && f.stateFrame < 8);
      v.contact.position.x = x + (lying ? -0.55 * f.facing : 0.02 * f.facing);
      v.contact.scale.set((lying ? 1.9 : 1) * (1 - lift * 0.45) * v.look.scale, (1 - lift * 0.45) * v.look.scale, 1);
      (v.contact.material as THREE.MeshBasicMaterial).opacity = 1 - lift * 0.75;

      // Weapon: extension from the pose; the staff leaves the hands while it is thrown.
      const staffOut = v.flyer !== null && m.projectiles.some((q) => q.owner === i && q.kind === 'staff');
      const w = rig.weapon;
      w.setVisible(!staffOut);
      w.setExtension(pose.blade, pose.blade2);
      const lit = w.lit;
      if (lit !== v.bladeLit && this.mode !== 'attract') {
        if (lit) this.audio.ignite(f.id, f.x);
        else this.audio.retract(f.id, f.x);
      }
      v.bladeLit = lit;
      // Dim the blade's point light as it nears a body (inverse-square hot spots wash costumes white).
      w.light.getWorldPosition(this.tmpV2);
      const other = this.views[i === 0 ? 1 : 0].rig;
      other.chestWorld(this.tmpV3);
      let near = this.tmpV2.distanceTo(this.tmpV3);
      this.tmpV3.y -= 0.55;
      near = Math.min(near, this.tmpV2.distanceTo(this.tmpV3));
      rig.chestWorld(this.tmpV3);
      near = Math.min(near, this.tmpV2.distanceTo(this.tmpV3) + 0.15);
      const dimTarget = THREE.MathUtils.clamp((near - 0.2) / 0.7, 0.18, 1);
      w.nearDim += (dimTarget - w.nearDim) * Math.min(1, dt * 20);
      w.update(dt, this.ambientTime, i * 3.1);
      // SF3-style parry flash reads blue; hit flashes stay subtle so limbs keep their shading.
      if (f.parryFlash > 0) rig.setFlash((f.parryFlash / 16) * 0.16, 0x4f9dff, true);
      else if (this.beamOwner !== -1 && this.beamOwner !== f.id && f.state !== 'block') rig.setFlash(0.03 + this.vfxRng() * 0.07, LIGHTNING, true);
      else rig.setFlash(f.flash > 0 ? (f.flash / 10) * (f.flash / 10) * 0.18 : 0, f.counterFlash > 0 ? 0xffc14a : 0xfff4e8);

      // Trails, one per blade.
      const showing = v.animator.showcasing !== '';
      const flipping = f.state === 'air' && (f.jumpDir !== 0 || f.runJump);
      const swinging =
        showing ||
        f.state === 'attack' ||
        f.state === 'clash' ||
        f.state === 'victory' ||
        f.state === 'parrySuccess' ||
        f.state === 'throwing' ||
        f.state === 'intro' ||
        flipping;
      let speed = 0;
      for (let k = 0; k < 2; k += 1) {
        const blade = w.blades[k];
        const trail = v.trails[k];
        if (!blade) continue;
        blade.ends(v.base[k], v.tip[k]);
        const moved = v.tip[k].distanceTo(v.lastTip[k]);
        const s = dt > 0 ? moved / dt : 0;
        speed = Math.max(speed, s);
        v.lastTip[k].copy(v.tip[k]);
        const on = blade.extension > 0.05 && !staffOut;
        const intensity = swinging && on ? THREE.MathUtils.smoothstep(s, 3, 12) * (flipping ? 0.4 : 1) : 0;
        if (dt > 0) trail.update(v.base[k], v.tip[k], intensity, dt);
      }
      v.tipSpeed = speed;

      // Thrown saberstaff: a spinning blade wheel following the projectile.
      if (v.flyer) {
        const q = m.projectiles.find((pp) => pp.owner === i && pp.kind === 'staff');
        v.flyer.main.visible = Boolean(q);
        if (q) {
          const prev = this.projPrev.get(q) ?? q;
          const px = m.frozen ? q.x : prev.x + (q.x - prev.x) * alpha;
          const py = m.frozen ? q.y : prev.y + (q.y - prev.y) * alpha;
          if (!m.frozen) v.flySpin += dt * 26 * (q.returning ? -1 : 1) * q.dir;
          v.flyer.main.position.set(px, py, 0.15);
          v.flyer.main.rotation.set(0, 0, v.flySpin);
          v.flyer.update(dt, this.ambientTime, i * 5.3);
        }
      }

      // Force charge glow at the casting hand (Push, Grip).
      const special = f.state === 'attack' && f.move?.id === 'special';
      const kind = f.def.special;
      let charge = 0;
      if (special && kind === 'wave' && f.stateFrame < 16) charge = Math.min(1, (f.stateFrame + alpha) / 13);
      if (special && kind === 'grip' && f.stateFrame < 22) charge = Math.min(1, (f.stateFrame + alpha) / 15);
      const gripping = f.state === 'throwing' && f.throwKind === 'grip';
      if (gripping) {
        this.gripOwner = f.id;
        charge = f.stateFrame < 46 ? 0.75 + Math.sin(this.ambientTime * 24) * 0.15 : Math.max(0, 1 - (f.stateFrame - 46) / 8);
        if (!this.reducedMotion && this.frame % 3 === 0 && f.stateFrame < 46) {
          this.views[i === 0 ? 1 : 0].rig.neckWorld(this.tmpV3);
          this.vfx.glowBurst(this.tmpV3, v.forceColor, 1, 0.5, 0.07, 0.35, 0.2);
        }
      }
      if (charge > 0) rig.offHandWorld(this.tmpV2);
      this.vfx.setCharge(i, charge, this.tmpV2, v.forceColor);

      // Super aura.
      const aura = f.state === 'attack' && f.move?.id === 'super' ? (m.superFreeze > 0 ? 1 : Math.max(0, 1 - f.stateFrame / 50)) : 0;
      this.vfx.setAura(i, aura, x, v.color);
      if (aura > 0.3 && !this.reducedMotion && this.frame % 2 === 0) {
        this.tmpV2.set(x + (this.vfxRng() - 0.5) * 0.8, 0.2 + this.vfxRng() * 1.6, (this.vfxRng() - 0.5) * 0.6);
        this.vfx.glowBurst(this.tmpV2, v.color, 1, 0.4, 0.09, 0.6, 2.5);
      }
    });

    if (this.beamOwner !== -1) {
      const caster = this.views[this.beamOwner];
      const target = this.views[this.beamOwner === 0 ? 1 : 0];
      caster.rig.offHandWorld(this.tmpV);
      caster.rig.swordHandWorld(this.tmpV2);
      target.rig.chestWorld(this.tmpV3);
      if (!m.frozen || this.frame % 3 === 0) this.vfx.setBeam(true, this.tmpV, this.tmpV2, this.tmpV3, LIGHTNING);
      if (!this.reducedMotion && this.frame % 2 === 0) this.vfx.glowBurst(this.tmpV3, LIGHTNING, 2, 1.6, 0.08, 0.25);
    } else if (this.vfx.beamActive) {
      this.vfx.setBeam(false, this.tmpV, this.tmpV, this.tmpV, LIGHTNING);
    }

    // Force waves.
    for (let owner = 0; owner < 2; owner += 1) {
      const q = m.projectiles.find((pp) => pp.owner === owner && pp.kind === 'wave');
      const color = this.views[owner].forceColor;
      if (q) {
        const prev = this.projPrev.get(q) ?? q;
        const x = m.frozen ? q.x : prev.x + (q.x - prev.x) * alpha;
        this.tmpV.set(x, q.y, 0.05);
        this.vfx.setWave(owner, true, this.tmpV, q.dir, color, q.age + alpha);
        if (!this.reducedMotion && this.frame % 2 === 0) this.vfx.glowBurst(this.tmpV, color, 2, 1.2, 0.1, 0.35);
      } else {
        this.vfx.setWave(owner, false, this.tmpV, 1, color, 0);
      }
    }

    // Super freeze dims the world; KO focus fades.
    const superTarget = m.superFreeze > 0 ? 1 : 0;
    this.superLevel += (superTarget - this.superLevel) * Math.min(1, dt * (superTarget ? 10 : 4));
    const owner = m.superOwner;
    this.ui.setSuperOverlay(this.superLevel * 0.9, owner !== -1 ? `#${this.views[owner].color.getHexString()}` : '#ffffff');
    this.audio.setDuck(m.hitstop > 0 ? 0.55 : this.superLevel > 0.1 ? 0.35 : this.slowmo > 0 ? 0.45 : 1);
    if (this.slowmo <= 0) this.koFocus = Math.max(0, this.koFocus - dt * 1.5);
  }

  private updateCamera(dt: number): void {
    const [a, b] = this.match.fighters;
    const owner = this.match.superOwner;
    if (this.debugFocus) {
      this.director.setFocus(1, this.debugFocus.x, this.debugFocus.y, this.debugFocus.dist);
    } else if (this.mode === 'select') {
      this.director.setFocus(1, 0, 0.55, 7.2);
    } else if (this.superLevel > 0.01 && owner !== -1) {
      const f = this.match.fighters[owner];
      this.director.setFocus(this.superLevel * 0.85, f.x + f.facing * 0.5, 1.25, 6.2);
    } else if (this.koFocus > 0.01) {
      this.director.setFocus(this.koFocus * 0.45, this.koFocusX, 0.8, 7.5);
    } else {
      this.director.setFocus(0, 0, 1.2, 8);
    }
    this.director.shakeEnabled = !this.reducedMotion;
    this.director.update(dt, a.x, b.x, Math.max(a.y, b.y));
  }

  private updateAudio(): void {
    if (!this.audio.unlocked) return;
    const live = (this.mode === 'cpu' || this.mode === 'versus') && !this.paused;
    this.match.fighters.forEach((f, i) => {
      const v = this.views[i];
      this.audio.updateSaber(f.id, v.bladeLit && v.rig.weapon.main.visible, f.x, v.tipSpeed);
    });
    const grip = live && this.gripOwner !== -1;
    this.audio.setGrip(grip, grip ? this.match.fighters[this.gripOwner as FighterId].x : 0);
    const beam = live && this.beamOwner !== -1;
    this.audio.setLightning(beam, beam ? this.match.fighters[this.beamOwner as FighterId].x : 0);
    const staff = live ? this.match.projectiles.find((q) => q.kind === 'staff') : undefined;
    this.audio.setSpinningBlade(Boolean(staff), staff?.x ?? 0, staff?.returning ? 0.6 : 1);
  }

  private pointScale(): number {
    return this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
  }

  private resize(): void {
    const width = Math.max(1, Math.floor(this.canvas.clientWidth));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    if (width === this.lastWidth && height === this.lastHeight && dpr === this.lastDpr) return;
    this.lastWidth = width;
    this.lastHeight = height;
    this.lastDpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height, dpr);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------- test hooks

  private stageFight(chars: [CharacterId, CharacterId] = ['kael', 'vexa'], gap = 1.55): void {
    this.startMatch('cpu', chars);
    this.match.skipIntro();
    this.match.events.length = 0;
    this.ui.clearAnnouncer();
    const [a, b] = this.match.fighters;
    a.x = -gap;
    b.x = gap;
    this.syncViewsToSim();
    this.director.snap(a.x, b.x);
  }

  /** Step the sim (with given inputs) without rendering — used to stage screenshot states. */
  private advance(frames: number, p0: Partial<InputFrame> = {}, p1: Partial<InputFrame> = {}): void {
    const i0 = { ...emptyInput(), ...p0 };
    const i1 = { ...emptyInput(), ...p1 };
    for (let k = 0; k < frames; k += 1) {
      this.snapshotPrev();
      this.match.step(i0, i1);
      this.match.events.length = 0;
    }
  }

  /** Step with neutral input until `done()` holds (bounded). */
  private advanceUntil(done: () => boolean, max: number): void {
    for (let k = 0; k < max && !done(); k += 1) this.advance(1);
  }

  /** Let the animators catch up with a staged sim state (clip blends settle). */
  private settleViews(): void {
    for (let k = 0; k < 12; k += 1) this.updateViews(1 / 60, 0);
  }

  private applyTestState(spec: string): void {
    this.screenshotPaused = false;
    const [name, c0, c1, n0] = spec.split(/[:.]/);
    const frameArg = Number(n0 ?? NaN);
    const chars: [CharacterId, CharacterId] = [isCharacter(c0) ? c0 : 'kael', isCharacter(c1) ? c1 : 'vexa'];
    switch (name) {
      case 'title':
        this.enterAttract();
        this.match.skipIntro();
        this.advance(30);
        break;
      case 'select':
        this.picks = chars;
        this.openSelect('cpu');
        break;
      case 'active-play':
        this.stageFight(chars);
        break;
      case 'exchange': {
        // Mid-round: damage, meter and a heavy slash in flight against a guard.
        this.stageFight(chars);
        const [a, b] = this.match.fighters;
        a.health = Math.round(a.maxHealth * 0.76);
        b.health = Math.round(b.maxHealth * 0.47);
        a.meter = 170;
        b.meter = 230;
        a.roundsWon = 1;
        this.match.timerFrames = 63 * SIM_HZ;
        this.advance(1, {}, { right: true });
        this.advance(a.def.moves.heavy.activeFrom, { heavy: true }, { right: true });
        this.ui.resetHud();
        break;
      }
      case 'clash': {
        this.stageFight(chars, 1.1);
        this.advance(6, { light: true }, { light: true });
        break;
      }
      case 'parry': {
        this.stageFight(chars, 1.0);
        const [a, b] = this.match.fighters;
        const heavy = b.def.moves.heavy;
        this.advance(1, {}, { heavy: true });
        this.advance(Math.max(0, heavy.activeFrom - 5));
        this.advance(1, { parry: true });
        this.advanceUntil(() => a.state === 'parrySuccess', 20);
        this.advance(3);
        break;
      }
      case 'throw': {
        // Light+Heavy at close range; optional 4th part = frames into the throw (e.g. throw.asha.kael.18).
        this.stageFight(chars, 0.5);
        const [a] = this.match.fighters;
        this.advance(1, { light: true, heavy: true });
        this.advanceUntil(() => a.state === 'throwing', 20);
        const target = Number.isFinite(frameArg) ? frameArg : 18;
        this.advanceUntil(() => a.state !== 'throwing' || a.stateFrame >= target, 60);
        break;
      }
      case 'chain': {
        // light → light → light on hit; optional 4th part = frames into the 3rd light.
        this.stageFight(chars, 0.6);
        const [a] = this.match.fighters;
        const want = 2;
        for (let k = 0; k < 120 && !(a.state === 'attack' && a.chain >= want); k += 1) this.advance(1, { light: k % 4 === 0 });
        this.advance(Number.isFinite(frameArg) ? frameArg : 5);
        break;
      }
      case 'grip': {
        this.stageFight(['vexa', chars[0] === 'vexa' ? 'kael' : chars[0]], 1.2);
        const [a] = this.match.fighters;
        a.meter = METER_MAX;
        this.advance(1, { force: true });
        this.advanceUntil(() => a.state === 'throwing' && a.stateFrame >= 30, 80);
        break;
      }
      case 'lightning': {
        this.stageFight(['vexa', chars[0] === 'vexa' ? 'kael' : chars[0]], 1.7);
        const [a] = this.match.fighters;
        a.meter = METER_MAX;
        this.advance(1, { down: true });
        this.advance(1, { down: true, force: true });
        this.advanceUntil(() => this.match.superFreeze === 0, SUPER_FREEZE + 4);
        this.advance(26);
        break;
      }
      case 'staff': {
        this.stageFight(['thane', chars[1] === 'thane' ? 'kael' : chars[1]], 1.7);
        const [a] = this.match.fighters;
        a.meter = METER_MAX;
        this.advance(1, { force: true });
        this.advance(24);
        break;
      }
      case 'leap': {
        this.stageFight(['asha', chars[1] === 'asha' ? 'kael' : chars[1]], 2.2);
        const [a] = this.match.fighters;
        a.meter = METER_MAX;
        this.advance(1, { force: true });
        this.advance(17);
        break;
      }
      case 'super': {
        this.stageFight(chars);
        const [a] = this.match.fighters;
        a.meter = METER_MAX;
        this.advance(1, { down: true });
        this.advance(1, { down: true, force: true });
        this.advance(Math.floor(SUPER_FREEZE * 0.6), { down: true });
        this.superLevel = 1;
        break;
      }
      case 'ko': {
        this.stageFight(chars, 1.15);
        const [, b] = this.match.fighters;
        b.health = 40;
        this.advance(this.match.fighters[0].def.moves.heavy.activeFrom + 2, { heavy: true });
        this.advance(70);
        break;
      }
      case 'pause':
        this.stageFight(chars);
        this.pause();
        break;
      case 'controls':
        this.enterAttract();
        this.ui.setScreen('controls');
        break;
      case 'result': {
        this.stageFight(chars);
        const [a, b] = this.match.fighters;
        a.roundsWon = 2;
        a.stats.damageDealt = 2140;
        a.stats.maxCombo = 4;
        a.stats.clashes = 3;
        a.stats.supers = 1;
        a.stats.parries = 2;
        b.roundsWon = 1;
        b.stats.damageDealt = 1585;
        b.stats.maxCombo = 3;
        b.stats.clashes = 3;
        b.stats.parries = 1;
        this.match.phase = 'matchOver';
        this.match.phaseFrame = 0;
        this.showResult(0);
        break;
      }
      default:
        throw new Error(`Unknown test state: ${name}`);
    }
    this.vfx.clear();
    this.settleViews();
    for (const v of this.views) {
      v.trails[0].reset();
      v.trails[1].reset();
    }
  }

  private modelsReady: Promise<unknown> = Promise.resolve();

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: async (value: number) => {
        await this.modelsReady;
        this.rng = createSeededRandom(value);
        this.vfxRng = createSeededRandom(value ^ 0x5f3759df);
        this.cpu = [
          new CpuController(this.match, 0, createSeededRandom(value + 11), 'hard'),
          new CpuController(this.match, 1, createSeededRandom(value + 12), this.mode === 'attract' ? 'hard' : this.difficulty),
        ];
      },
      setState: async (name: string) => {
        await this.modelsReady;
        this.applyTestState(name);
        this.updateViews(0, 0);
        this.updateCamera(0.5);
        this.publishDiagnostics();
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.screenshotPaused = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        this.arena.setReducedMotion(enabled);
        this.vfx.setReducedMotion(enabled);
        if (enabled) this.ambientTime = 0;
        this.publishDiagnostics();
      },
      hideDebugUi: (hidden: boolean) => {
        this.debug?.setVisible(!hidden);
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const [a, b] = this.match.fighters;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: a.stats.damageDealt,
      targetScore: b.maxHealth * 2,
      complete: this.match.phase === 'matchOver',
      player: {
        position: { x: a.x, y: a.y, z: 0 },
        speed: Math.abs(a.x - this.views[0].prevX) * SIM_HZ,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.maxDpr),
      },
      game: {
        mode: this.mode,
        screen: this.ui.current as Screen,
        phase: this.match.phase,
        round: this.match.round,
        seconds: this.match.secondsLeft,
        quality: this.quality,
        paused: this.paused,
        select: this.mode === 'select' ? { cursor: [...this.sel.cursor], locked: [...this.sel.locked], active: this.sel.active } : null,
        fighters: this.match.fighters.map((f, i) => ({
          char: this.views[i].char,
          x: +f.x.toFixed(3),
          y: +f.y.toFixed(3),
          state: f.state,
          move: f.move?.id ?? null,
          clip: this.views[i].animator.showcasing || null,
          health: f.health,
          maxHealth: f.maxHealth,
          meter: Math.round(f.meter),
          rounds: f.roundsWon,
          facing: f.facing,
        })),
        events: { ...this.eventCounts },
      },
    };
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.arena.dispose();
    this.vfx.dispose();
    this.post.dispose();
    for (const rig of this.rigs.values()) rig.dispose();
    for (const w of this.flyers.values()) w.dispose();
    for (const v of this.views) {
      v.trails[0].dispose();
      v.trails[1].dispose();
    }
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }
}
