import { METER_BAR, METER_MAX } from '../sim/constants';
import { ROSTER } from '../sim/roster';
import { CHARACTER_IDS, type CharacterId } from '../sim/types';
import type { Match } from '../sim/Match';
import type { MenuAction } from '../core/Input';

export type Screen = 'title' | 'select' | 'fight' | 'pause' | 'controls' | 'result';

export interface SelectView {
  cursor: [number, number];
  locked: [boolean, boolean];
  /** Which cursor is choosing (CPU mode is sequential). */
  active: 0 | 1 | 'both';
  versus: boolean;
}
export type Difficulty = 'easy' | 'normal' | 'hard';

interface SideEls {
  panel: HTMLElement;
  name: HTMLElement;
  fill: HTMLElement;
  trail: HTMLElement;
  pips: HTMLElement[];
  meter: HTMLElement;
  cells: HTMLElement[];
  count: HTMLElement;
  hint: HTMLElement;
  callout: HTMLElement;
  calloutBig: HTMLElement;
  calloutSmall: HTMLElement;
}

function q<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

export interface ResultStats {
  name: string;
  damage: number;
  maxCombo: number;
  clashes: number;
  supers: number;
  parries: number;
  rounds: number;
}

/** DOM HUD, announcer and menus. Reads match state; emits intents via callbacks. */
export class Ui {
  onAction: ((action: string) => void) | null = null;
  onDifficulty: ((difficulty: Difficulty) => void) | null = null;
  onSound: (() => void) | null = null;
  onUiSound: ((kind: 'move' | 'select' | 'back') => void) | null = null;

  private screen: Screen = 'title';
  private screenChangedAt = 0;
  private returnScreen: Screen = 'title';
  private readonly sides: [SideEls, SideEls];
  private readonly timer: HTMLElement;
  private readonly timerFrame: HTMLElement;
  private readonly announcer: HTMLElement;
  private readonly announceText: HTMLElement;
  private readonly announceSub: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly superEl: HTMLElement;
  private readonly soundButton: HTMLElement;
  private readonly trails = [1, 1];
  private readonly trailHold = [0, 0];
  private readonly lastHealth = [1, 1];
  private readonly cards: HTMLButtonElement[] = [];
  onPick: ((index: number) => void) | null = null;
  private lastTimer = -1;
  private readonly calloutTimers = [0, 0];
  private announceAnim: Animation | null = null;

  constructor(private readonly app: HTMLElement) {
    const side = (i: 0 | 1): SideEls => {
      const panel = q<HTMLElement>(app, `.fighter-panel[data-side="${i}"]`);
      const meter = q<HTMLElement>(app, `.meter[data-side="${i}"]`);
      const callout = q<HTMLElement>(app, `.callout[data-side="${i}"]`);
      return {
        panel,
        name: q(panel, '.name'),
        fill: q(panel, '.health-fill'),
        trail: q(panel, '.health-trail'),
        pips: [...panel.querySelectorAll<HTMLElement>('.pips i')],
        meter,
        cells: [...meter.querySelectorAll<HTMLElement>('.meter-cells b')],
        count: q(meter, '.meter-count'),
        hint: q(meter, '.meter-hint'),
        callout,
        calloutBig: q(callout, 'strong'),
        calloutSmall: q(callout, 'span'),
      };
    };
    this.sides = [side(0), side(1)];
    this.timer = q(app, '#timer');
    this.timerFrame = q(app, '.timer-frame');
    this.announcer = q(app, '#announcer');
    this.announceText = q(this.announcer, '.announce-text');
    this.announceSub = q(this.announcer, '.announce-sub');
    this.flashEl = q(app, '#flash-overlay');
    this.superEl = q(app, '#super-overlay');
    this.soundButton = q(app, '#sound-button');

    app.querySelectorAll<HTMLButtonElement>('.menu-item').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (!action) return;
        this.onUiSound?.(action === 'back' || action === 'quit' ? 'back' : 'select');
        this.onAction?.(action);
      });
      button.addEventListener('pointerenter', () => {
        if (document.activeElement !== button) button.focus({ preventScroll: true });
      });
      button.addEventListener('focus', () => this.onUiSound?.('move'));
    });
    app.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach((button) => {
      button.addEventListener('click', () => {
        const d = button.dataset.difficulty as Difficulty;
        this.setDifficulty(d);
        this.onUiSound?.('select');
        this.onDifficulty?.(d);
      });
    });
    this.soundButton.addEventListener('click', () => this.onSound?.());
    this.buildRoster();
    q<HTMLElement>(app, '#pause-button').addEventListener('click', () => this.onAction?.('pause'));
  }

  private buildRoster(): void {
    const box = q<HTMLElement>(this.app, '.roster');
    const stats: Record<CharacterId, [number, number, number, number]> = {
      kael: [3, 3, 3, 4],
      vexa: [5, 2, 3, 3],
      asha: [2, 5, 2, 2],
      thane: [3, 3, 5, 3],
    };
    const colors: Record<CharacterId, string> = { kael: '#45a6ff', vexa: '#ff3d3d', asha: '#3ee06a', thane: '#ffc83d' };
    CHARACTER_IDS.forEach((id, i) => {
      const def = ROSTER[id];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.dataset.char = id;
      card.style.setProperty('--accent', colors[id]);
      const [pow, spd, rch, def_] = stats[id];
      card.innerHTML = `
        <span class="card-blade" aria-hidden="true"></span>
        <span class="card-name"></span>
        <span class="card-title"></span>
        <span class="card-style"></span>
        <span class="card-moves"></span>
        <span class="card-stats">
          <span>POWER<i style="--v:${pow}"></i></span>
          <span>SPEED<i style="--v:${spd}"></i></span>
          <span>REACH<i style="--v:${rch}"></i></span>
          <span>GUARD<i style="--v:${def_}"></i></span>
        </span>
        <span class="card-tag p1">P1</span>
        <span class="card-tag p2">P2</span>`;
      q(card, '.card-name').textContent = def.name;
      q(card, '.card-title').textContent = def.title;
      q(card, '.card-style').textContent = def.style;
      q(card, '.card-moves').textContent = `${def.specialName} · ${def.superName}`;
      card.addEventListener('click', () => this.onPick?.(i));
      box.appendChild(card);
      this.cards.push(card);
    });
  }

  updateSelect(view: SelectView): void {
    this.cards.forEach((card, i) => {
      card.classList.toggle('p1', view.cursor[0] === i);
      card.classList.toggle('p2', view.cursor[1] === i && (view.versus || view.active === 1 || view.locked[1]));
      card.classList.toggle('locked1', view.locked[0] && view.cursor[0] === i);
      card.classList.toggle('locked2', view.locked[1] && view.cursor[1] === i);
    });
    const prompt = q(this.app, '.select-prompt');
    const touch = this.app.classList.contains('touch-mode');
    const text = view.versus
      ? touch
        ? 'Tap a card for P1, then for P2'
        : 'P1  A/D + J   ·   P2  ←/→ + ,'
      : view.active === 0
        ? touch
          ? 'Tap your duelist'
          : 'Choose your duelist  ·  ←/→ then J or Enter'
        : touch
          ? 'Tap your opponent'
          : 'Choose your opponent  ·  K / Backspace to go back';
    if (prompt.textContent !== text) prompt.textContent = text;
  }

  get current(): Screen {
    return this.screen;
  }

  setScreen(screen: Screen): void {
    if (screen === 'controls') this.returnScreen = this.screen === 'controls' ? this.returnScreen : this.screen;
    this.screen = screen;
    this.screenChangedAt = performance.now();
    this.app.dataset.screen = screen;
    const visible = this.visibleMenu();
    if (visible) {
      const first = visible.querySelector<HTMLButtonElement>('.menu-item');
      requestAnimationFrame(() => first?.focus({ preventScroll: true }));
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  /** Where "back" from the controls screen should go. */
  get controlsReturn(): Screen {
    return this.returnScreen;
  }

  private visibleMenu(): HTMLElement | null {
    switch (this.screen) {
      case 'title':
        return q(this.app, '#title-screen');
      case 'select':
        return q(this.app, '#select-screen');
      case 'pause':
        return q(this.app, '#pause-screen');
      case 'controls':
        return q(this.app, '#controls-screen');
      case 'result':
        return q(this.app, '#result-screen');
      default:
        return null;
    }
  }

  /** Keyboard / gamepad menu navigation. Returns true if consumed. */
  navigate(action: MenuAction): boolean {
    const menu = this.visibleMenu();
    if (!menu) return false;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('.menu-item')];
    if (items.length === 0) return false;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (action === 'up' || action === 'down') {
      const next = index < 0 ? 0 : (index + (action === 'down' ? 1 : -1) + items.length) % items.length;
      items[next].focus({ preventScroll: true });
      return true;
    }
    if ((action === 'left' || action === 'right') && this.screen === 'title') {
      const order: Difficulty[] = ['easy', 'normal', 'hard'];
      const current = (this.app.querySelector<HTMLElement>('[data-difficulty][aria-checked="true"]')?.dataset.difficulty ?? 'normal') as Difficulty;
      const i = Math.max(0, Math.min(2, order.indexOf(current) + (action === 'right' ? 1 : -1)));
      if (order[i] !== current) {
        this.setDifficulty(order[i]);
        this.onUiSound?.('move');
        this.onDifficulty?.(order[i]);
      }
      return true;
    }
    if (action === 'confirm') {
      // Ignore confirms mashed through from the fight (e.g. the slash key) right after a screen appears.
      if (performance.now() - this.screenChangedAt < 650) return true;
      (index >= 0 ? items[index] : items[0]).click();
      return true;
    }
    if (action === 'back' || action === 'pause') {
      if (this.screen === 'controls') this.onAction?.('back');
      else if (this.screen === 'pause') this.onAction?.('resume');
      return true;
    }
    return false;
  }

  setDifficulty(d: Difficulty): void {
    this.app.querySelectorAll<HTMLElement>('[data-difficulty]').forEach((el) => {
      el.setAttribute('aria-checked', String(el.dataset.difficulty === d));
    });
  }

  setSoundState(muted: boolean): void {
    this.soundButton.setAttribute('aria-pressed', String(muted));
    this.soundButton.classList.toggle('muted', muted);
  }

  setNames(a: string, b: string, colorA = '#cfe7ff', colorB = '#ffd6d6'): void {
    this.sides[0].name.textContent = a;
    this.sides[1].name.textContent = b;
    this.sides[0].name.style.color = colorA;
    this.sides[1].name.style.color = colorB;
  }

  setTouchMode(enabled: boolean): void {
    this.app.classList.toggle('touch-mode', enabled);
  }

  resetHud(): void {
    for (let i = 0; i < 2; i += 1) {
      this.trails[i] = 1;
      this.trailHold[i] = 0;
      this.lastHealth[i] = 1;
      this.sides[i].callout.classList.remove('show');
    }
    this.lastTimer = -1;
  }

  updateHud(match: Match, dt: number): void {
    match.fighters.forEach((f, i) => {
      const s = this.sides[i];
      const health = Math.max(0, f.health) / f.maxHealth;
      if (health < this.lastHealth[i]) this.trailHold[i] = 0.55;
      this.lastHealth[i] = health;
      if (this.trailHold[i] > 0) this.trailHold[i] -= dt;
      else this.trails[i] = Math.max(health, this.trails[i] - 0.9 * dt);
      if (this.trails[i] < health) this.trails[i] = health;
      s.fill.style.transform = `scaleX(${health})`;
      s.trail.style.transform = `scaleX(${this.trails[i]})`;
      s.panel.classList.toggle('danger', health > 0 && health <= 0.25);
      s.panel.classList.toggle('hit', f.flash > 0);
      s.pips.forEach((pip, k) => pip.classList.toggle('won', f.roundsWon > k));

      const meter = Math.min(METER_MAX, f.meter);
      for (let c = 0; c < 3; c += 1) {
        const fill = Math.max(0, Math.min(1, (meter - c * METER_BAR) / METER_BAR));
        s.cells[c].style.transform = `scaleX(${fill})`;
        s.cells[c].parentElement?.classList.toggle('full', fill >= 1);
      }
      const bars = Math.floor(meter / METER_BAR);
      if (s.count.textContent !== String(bars)) s.count.textContent = String(bars);
      const ready = meter >= METER_MAX;
      s.meter.classList.toggle('ready', ready);
      const hint = ready ? `${f.def.superName.toUpperCase()} ↓+F` : f.def.specialName.toUpperCase();
      if (s.hint.textContent !== hint) s.hint.textContent = hint;

      if (this.calloutTimers[i] > 0) {
        this.calloutTimers[i] -= dt;
        if (this.calloutTimers[i] <= 0) s.callout.classList.remove('show');
      }
    });

    const seconds = match.secondsLeft;
    if (seconds !== this.lastTimer) {
      this.lastTimer = seconds;
      this.timer.textContent = String(seconds).padStart(2, '0');
      this.timerFrame.classList.toggle('low', seconds <= 10 && match.phase === 'fight');
    }
  }

  /** Big centred announcer text (ROUND 1, FIGHT!, K.O.). */
  announce(text: string, sub = '', variant: 'round' | 'fight' | 'ko' | 'win' | 'time' = 'round', durationMs = 1100): void {
    this.announceText.textContent = text;
    this.announceSub.textContent = sub;
    this.announcer.dataset.variant = variant;
    this.announceAnim?.cancel();
    this.announceAnim = this.announcer.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', filter: 'blur(0px)', offset: 0.14 },
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1.03)', offset: 0.8 },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.08)' },
      ],
      { duration: durationMs, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    );
  }

  clearAnnouncer(): void {
    this.announceAnim?.cancel();
    this.announceAnim = null;
    this.announcer.style.opacity = '0';
  }

  callout(side: 0 | 1, big: string, small: string, kind: 'combo' | 'counter' | 'clash' | 'info' | 'parry' = 'combo'): void {
    const s = this.sides[side];
    s.calloutBig.textContent = big;
    s.calloutSmall.textContent = small;
    s.callout.dataset.kind = kind;
    s.callout.classList.remove('show');
    void s.callout.offsetWidth;
    s.callout.classList.add('show');
    this.calloutTimers[side] = 1.1;
  }

  meterDenied(side: 0 | 1): void {
    this.sides[side].meter.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
      { duration: 220, easing: 'ease-out' },
    );
  }

  flash(color: string, peak: number, durationMs = 120): void {
    this.flashEl.style.background = color;
    this.flashEl.animate([{ opacity: peak }, { opacity: 0 }], { duration: durationMs, easing: 'ease-out' });
  }

  setSuperOverlay(level: number, color: string): void {
    this.superEl.style.opacity = String(level);
    this.superEl.style.setProperty('--super-color', color);
  }

  showResult(title: string, kicker: string, stats: ResultStats[]): void {
    q(this.app, '.result-title').textContent = title;
    q(this.app, '.result-kicker').textContent = kicker;
    const box = q(this.app, '.result-stats');
    box.innerHTML = '';
    for (const s of stats) {
      const col = document.createElement('div');
      col.className = 'result-col';
      col.innerHTML = `<h3></h3><dl>
        <dt>Rounds</dt><dd>${s.rounds}</dd>
        <dt>Damage</dt><dd>${s.damage}</dd>
        <dt>Best combo</dt><dd>${s.maxCombo}</dd>
        <dt>Parries</dt><dd>${s.parries}</dd>
        <dt>Clashes</dt><dd>${s.clashes}</dd>
        <dt>Supers</dt><dd>${s.supers}</dd></dl>`;
      q(col, 'h3').textContent = s.name;
      box.appendChild(col);
    }
  }
}
