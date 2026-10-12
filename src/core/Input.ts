import { BUTTONS, emptyInput, type Button, type InputFrame } from '../sim/types';

type Bindings = Record<Button, string[]>;

export const P1_KEYS: Bindings = {
  left: ['KeyA'],
  right: ['KeyD'],
  up: ['KeyW'],
  down: ['KeyS'],
  light: ['KeyJ'],
  heavy: ['KeyK'],
  force: ['KeyL'],
  parry: ['KeyI'],
};

export const P2_KEYS: Bindings = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  light: ['Comma', 'Numpad1'],
  heavy: ['Period', 'Numpad2'],
  force: ['Slash', 'Numpad3'],
  parry: ['Semicolon', 'Numpad0'],
};

const GAME_KEYS = new Set([...Object.values(P1_KEYS).flat(), ...Object.values(P2_KEYS).flat(), 'Space']);

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause';


interface PadEdges {
  [k: string]: boolean;
}

/**
 * Keyboard (two players), gamepads and the touch stick/buttons, all reduced to InputFrames.
 * Menu navigation is emitted separately through onMenu.
 */
export class InputManager {
  private readonly keys = new Set<string>();
  /** Keys/pad buttons held when a menu closed: ignored until released so they don't fire attacks. */
  private readonly suppressed = new Set<string>();
  private readonly padSuppressed: Array<Set<number>> = [new Set(), new Set(), new Set(), new Set()];
  private readonly touch: InputFrame = emptyInput();
  private readonly stickVec = { x: 0, y: 0 };
  private stickPointer: number | null = null;
  private readonly buttonPointers = new Map<number, Button[]>();
  private readonly padPrev: PadEdges[] = [{}, {}, {}, {}];
  /** Returns true when a menu consumed the action (the key's default is then suppressed). */
  onMenu: ((action: MenuAction, source: 'key' | 'pad', player: 0 | 1) => boolean) | null = null;
  onAnyInput: (() => void) | null = null;
  /** True once a touch control has been used — the UI then shows touch hints. */
  touchUsed = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (GAME_KEYS.has(event.code) && !(event.target instanceof HTMLInputElement)) event.preventDefault();
    this.onAnyInput?.();
    if (event.repeat) return;
    this.keys.add(event.code);
    const action = this.keyToMenu(event.code);
    if (action && this.onMenu?.(action, 'key', this.keyPlayer(event.code))) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    this.suppressed.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.suppressed.clear();
    this.releaseTouch();
  };

  /** Ignore everything currently held (keys and pad buttons) until it is released. */
  suppressHeld(): void {
    for (const code of this.keys) this.suppressed.add(code);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length && i < 4; i += 1) {
      const pad = pads[i];
      this.padSuppressed[i].clear();
      if (!pad) continue;
      pad.buttons.forEach((b, index) => {
        if (b.pressed) this.padSuppressed[i].add(index);
      });
    }
  }

  constructor(
    private readonly stick: HTMLElement,
    private readonly knob: HTMLElement,
    private readonly touchButtons: HTMLElement[],
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);

    stick.addEventListener('pointerdown', this.onStickDown);
    stick.addEventListener('pointermove', this.onStickMove);
    stick.addEventListener('pointerup', this.onStickUp);
    stick.addEventListener('pointercancel', this.onStickUp);
    stick.addEventListener('lostpointercapture', this.onStickUp);
    for (const el of touchButtons) {
      el.addEventListener('pointerdown', this.onButtonDown);
      el.addEventListener('pointerup', this.onButtonUp);
      el.addEventListener('pointercancel', this.onButtonUp);
      el.addEventListener('pointerleave', this.onButtonUp);
      el.addEventListener('lostpointercapture', this.onButtonUp);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  private keyPlayer(code: string): 0 | 1 {
    return code.startsWith('Arrow') || code === 'Comma' || code === 'Period' || code === 'Slash' || code === 'Semicolon' || code.startsWith('Numpad') ? 1 : 0;
  }

  private keyToMenu(code: string): MenuAction | null {
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        return 'up';
      case 'ArrowDown':
      case 'KeyS':
        return 'down';
      case 'ArrowLeft':
      case 'KeyA':
        return 'left';
      case 'ArrowRight':
      case 'KeyD':
        return 'right';
      case 'Enter':
      case 'Space':
      case 'KeyJ':
      case 'Comma':
      case 'Numpad1':
        return 'confirm';
      case 'Backspace':
      case 'KeyK':
      case 'Period':
      case 'Numpad2':
        return 'back';
      case 'Escape':
      case 'KeyP':
        return 'pause';
      default:
        return null;
    }
  }

  // ----------------------------------------------------------------- touch

  private readonly onStickDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.touchUsed = true;
    this.onAnyInput?.();
    this.stickPointer = event.pointerId;
    try {
      this.stick.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers cannot always be captured.
    }
    this.updateStick(event.clientX, event.clientY);
  };

  private readonly onStickMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.stickPointer) return;
    event.preventDefault();
    this.updateStick(event.clientX, event.clientY);
  };

  private readonly onStickUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.stickVec.x = 0;
    this.stickVec.y = 0;
    this.applyStick();
  };

  private updateStick(clientX: number, clientY: number): void {
    const rect = this.stick.getBoundingClientRect();
    const r = rect.width * 0.38;
    let x = (clientX - (rect.left + rect.width / 2)) / r;
    let y = (clientY - (rect.top + rect.height / 2)) / r;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.stickVec.x = x;
    this.stickVec.y = y;
    this.applyStick();
  }

  private applyStick(): void {
    const { x, y } = this.stickVec;
    this.touch.left = x < -0.4;
    this.touch.right = x > 0.4;
    this.touch.up = y < -0.55;
    this.touch.down = y > 0.5;
    this.knob.style.transform = `translate(calc(-50% + ${x * 34}px), calc(-50% + ${y * 34}px))`;
    this.stick.classList.toggle('engaged', this.stickPointer !== null);
  }

  private readonly onButtonDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.touchUsed = true;
    this.onAnyInput?.();
    const el = event.currentTarget as HTMLElement;
    const buttons = (el.dataset.buttons ?? '').split(' ').filter(Boolean) as Button[];
    this.buttonPointers.set(event.pointerId, buttons);
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    el.classList.add('pressed');
    this.recomputeTouchButtons();
  };

  private readonly onButtonUp = (event: PointerEvent): void => {
    if (!this.buttonPointers.has(event.pointerId)) return;
    this.buttonPointers.delete(event.pointerId);
    (event.currentTarget as HTMLElement).classList.remove('pressed');
    this.recomputeTouchButtons();
  };

  private recomputeTouchButtons(): void {
    this.touch.light = false;
    this.touch.heavy = false;
    this.touch.force = false;
    this.touch.parry = false;
    for (const list of this.buttonPointers.values()) {
      for (const b of list) {
        if (b === 'light' || b === 'heavy' || b === 'force' || b === 'parry') this.touch[b] = true;
      }
    }
  }

  private releaseTouch(): void {
    this.stickPointer = null;
    this.stickVec.x = 0;
    this.stickVec.y = 0;
    this.applyStick();
    this.buttonPointers.clear();
    for (const el of this.touchButtons) el.classList.remove('pressed');
    this.recomputeTouchButtons();
  }

  // -------------------------------------------------------------- sampling

  /**
   * Fill `out` with player input. In solo mode player 0 accepts both keyboard layouts, the touch
   * controls and any gamepad.
   */
  sample(player: 0 | 1, solo: boolean, out: InputFrame): InputFrame {
    const layouts = solo ? [P1_KEYS, P2_KEYS] : [player === 0 ? P1_KEYS : P2_KEYS];
    for (const b of BUTTONS) {
      let down = false;
      for (const layout of layouts) {
        for (const code of layout[b]) {
          if (this.keys.has(code) && !this.suppressed.has(code)) down = true;
        }
      }
      out[b] = down;
    }
    if (player === 0) {
      for (const b of BUTTONS) out[b] ||= this.touch[b];
    }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i += 1) {
      const pad = pads[i];
      if (!pad || !pad.connected) continue;
      const owner = solo ? 0 : i === 0 ? 0 : i === 1 ? 1 : -1;
      if (owner !== player) continue;
      this.readPad(pad, out, this.padSuppressed[i] ?? new Set<number>());
    }
    return out;
  }

  private readPad(pad: Gamepad, out: InputFrame, held: Set<number>): void {
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const btn = (i: number) => {
      const pressed = Boolean(pad.buttons[i]?.pressed);
      if (!pressed) held.delete(i);
      return pressed && !held.has(i);
    };
    out.left ||= ax < -0.45 || btn(14);
    out.right ||= ax > 0.45 || btn(15);
    out.up ||= ay < -0.6 || btn(12);
    out.down ||= ay > 0.5 || btn(13);
    // X light, Y heavy, B / right bumper Force, A / left bumper parry.
    out.light ||= btn(2);
    out.heavy ||= btn(3);
    out.force ||= btn(1) || btn(5) || btn(7);
    out.parry ||= btn(0) || btn(4) || btn(6);
  }

  /** Poll gamepads for menu navigation edges; call once per rendered frame. */
  pollMenuPads(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length && i < 4; i += 1) {
      const pad = pads[i];
      if (!pad || !pad.connected) continue;
      const prev = this.padPrev[i];
      const now: PadEdges = {
        up: Boolean(pad.buttons[12]?.pressed) || (pad.axes[1] ?? 0) < -0.6,
        down: Boolean(pad.buttons[13]?.pressed) || (pad.axes[1] ?? 0) > 0.6,
        left: Boolean(pad.buttons[14]?.pressed) || (pad.axes[0] ?? 0) < -0.6,
        right: Boolean(pad.buttons[15]?.pressed) || (pad.axes[0] ?? 0) > 0.6,
        confirm: Boolean(pad.buttons[0]?.pressed),
        back: Boolean(pad.buttons[1]?.pressed),
        pause: Boolean(pad.buttons[9]?.pressed),
      };
      for (const key of Object.keys(now)) {
        if (now[key] && !prev[key]) {
          this.onAnyInput?.();
          this.onMenu?.(key as MenuAction, 'pad', i === 1 ? 1 : 0);
        }
        prev[key] = now[key];
      }
    }
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.stick.removeEventListener('pointerdown', this.onStickDown);
    this.stick.removeEventListener('pointermove', this.onStickMove);
    this.stick.removeEventListener('pointerup', this.onStickUp);
    this.stick.removeEventListener('pointercancel', this.onStickUp);
    this.stick.removeEventListener('lostpointercapture', this.onStickUp);
    for (const el of this.touchButtons) {
      el.removeEventListener('pointerdown', this.onButtonDown);
      el.removeEventListener('pointerup', this.onButtonUp);
      el.removeEventListener('pointercancel', this.onButtonUp);
      el.removeEventListener('pointerleave', this.onButtonUp);
      el.removeEventListener('lostpointercapture', this.onButtonUp);
    }
  }
}
