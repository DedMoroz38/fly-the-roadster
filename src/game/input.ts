/** Logical game actions decoupled from physical keys. */
export type Action =
  | 'accelerate'
  | 'thrust'
  | 'rollLeft'
  | 'rollRight'
  | 'steerLeft'
  | 'steerRight'
  | 'suction'
  | 'restart'
  | 'pause'
  | 'help'
  | 'menu'
  | 'debug'
  /** Touch turn pad: steers on a surface, rolls in the air. */
  | 'turnLeft'
  | 'turnRight';

export const KEY_BINDINGS: Record<string, Action> = {
  KeyW: 'accelerate',
  Space: 'thrust',
  ArrowUp: 'accelerate',
  ArrowLeft: 'rollLeft',
  ArrowRight: 'rollRight',
  KeyA: 'steerLeft',
  KeyD: 'steerRight',
  ShiftLeft: 'suction',
  ShiftRight: 'suction',
  KeyR: 'restart',
  Escape: 'pause',
  KeyH: 'help',
  KeyM: 'menu',
  F3: 'debug',
};

/** Snapshot consumed by the simulation each fixed step. */
export interface ControlState {
  accelerate: boolean;
  thrust: boolean;
  rollLeft: boolean;
  rollRight: boolean;
  steerLeft: boolean;
  steerRight: boolean;
  /** Held Shift: active on every snapshot until key release or input clear. */
  suction: boolean;
}

export const emptyControls = (): ControlState => ({
  accelerate: false,
  thrust: false,
  rollLeft: false,
  rollRight: false,
  steerLeft: false,
  steerRight: false,
  suction: false,
});

/**
 * Tracks held keys and edge-triggered presses. Independent of the DOM so it can be unit
 * tested; `attach` wires it to a window.
 */
export class InputManager {
  private held = new Set<Action>();
  private keys = new Set<string>();
  private blockedUntilRelease = new Set<string>();
  private pressed = new Set<Action>();
  /** On-screen controls: each touch source (button, finger) holds at most one action. */
  private virtual = new Map<string, Action>();

  keyDown(code: string, repeat = false): boolean {
    const action = KEY_BINDINGS[code];
    if (!action) return false;
    if (this.blockedUntilRelease.has(code)) return true;
    if (!repeat && !this.held.has(action)) this.pressed.add(action);
    this.keys.add(code);
    this.held.add(action);
    return true;
  }

  keyUp(code: string): boolean {
    const action = KEY_BINDINGS[code];
    if (!action) return false;
    this.blockedUntilRelease.delete(code);
    this.keys.delete(code);
    if (![...this.keys].some((key) => KEY_BINDINGS[key] === action)) this.held.delete(action);
    return true;
  }

  /** An on-screen control starts (or switches) holding `action` for `source`. */
  press(source: string, action: Action) {
    if (this.virtual.get(source) === action) return;
    if (!this.isHeld(action)) this.pressed.add(action);
    this.virtual.set(source, action);
  }

  release(source: string) {
    this.virtual.delete(source);
  }

  /** Releases everything (e.g. on window blur, so keys don't get stuck). */
  clear() {
    this.virtual.clear();
    this.blockedUntilRelease.clear();
    this.keys.clear();
    this.held.clear();
    this.pressed.clear();
  }

  /** Menu/start inputs cannot become gameplay inputs until their physical keys are released. */
  clearUntilRelease() {
    for (const key of this.keys) this.blockedUntilRelease.add(key);
    this.virtual.clear();
    this.keys.clear();
    this.held.clear();
    this.pressed.clear();
  }

  isHeld(action: Action): boolean {
    if (this.held.has(action)) return true;
    for (const held of this.virtual.values()) if (held === action) return true;
    return false;
  }

  /** Returns true once per physical press, then forgets it. */
  consumePress(action: Action): boolean {
    const had = this.pressed.has(action);
    this.pressed.delete(action);
    return had;
  }

  /** Builds the held control snapshot for one simulation step; `airborne` routes the touch turn pad. */
  sample(airborne = false): ControlState {
    const turnLeft = this.isHeld('turnLeft'), turnRight = this.isHeld('turnRight');
    return {
      accelerate: this.isHeld('accelerate'),
      thrust: this.isHeld('thrust'),
      rollLeft: this.isHeld('rollLeft') || (airborne && turnLeft),
      rollRight: this.isHeld('rollRight') || (airborne && turnRight),
      steerLeft: this.isHeld('steerLeft') || (!airborne && turnLeft),
      steerRight: this.isHeld('steerRight') || (!airborne && turnRight),
      suction: this.isHeld('suction'),
    };
  }

  attach(target: Window): () => void {
    const down = (e: KeyboardEvent) => {
      if (this.keyDown(e.code, e.repeat)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (this.keyUp(e.code)) e.preventDefault();
    };
    const blur = () => this.clear();
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    };
  }
}
