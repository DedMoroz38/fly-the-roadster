/** Logical game actions decoupled from physical keys. */
export type Action =
  | 'accelerate'
  | 'brake'
  | 'thrust'
  | 'forwardThrust'
  | 'rollLeft'
  | 'rollRight'
  | 'steerLeft'
  | 'steerRight'
  | 'suction'
  | 'restart'
  | 'pause'
  | 'help';

export const KEY_BINDINGS: Record<string, Action> = {
  KeyW: 'accelerate',
  KeyS: 'brake',
  Space: 'thrust',
  ArrowUp: 'forwardThrust',
  ArrowLeft: 'rollLeft',
  ArrowRight: 'rollRight',
  KeyA: 'steerLeft',
  KeyD: 'steerRight',
  KeyE: 'suction',
  KeyR: 'restart',
  Escape: 'pause',
  KeyH: 'help',
};

/** Snapshot consumed by the simulation each fixed step. */
export interface ControlState {
  accelerate: boolean;
  brake: boolean;
  thrust: boolean;
  forwardThrust: boolean;
  rollLeft: boolean;
  rollRight: boolean;
  steerLeft: boolean;
  steerRight: boolean;
  /** Edge-triggered: true for exactly one consumed snapshot per key press. */
  toggleSuction: boolean;
}

export const emptyControls = (): ControlState => ({
  accelerate: false,
  brake: false,
  thrust: false,
  forwardThrust: false,
  rollLeft: false,
  rollRight: false,
  steerLeft: false,
  steerRight: false,
  toggleSuction: false,
});

/**
 * Tracks held keys and edge-triggered presses. Independent of the DOM so it can be unit
 * tested; `attach` wires it to a window.
 */
export class InputManager {
  private held = new Set<Action>();
  private pressed = new Set<Action>();

  keyDown(code: string, repeat = false): boolean {
    const action = KEY_BINDINGS[code];
    if (!action) return false;
    if (!repeat && !this.held.has(action)) this.pressed.add(action);
    this.held.add(action);
    return true;
  }

  keyUp(code: string): boolean {
    const action = KEY_BINDINGS[code];
    if (!action) return false;
    this.held.delete(action);
    return true;
  }

  /** Releases everything (e.g. on window blur, so keys don't get stuck). */
  clear() {
    this.held.clear();
    this.pressed.clear();
  }

  isHeld(action: Action): boolean {
    return this.held.has(action);
  }

  /** Returns true once per physical press, then forgets it. */
  consumePress(action: Action): boolean {
    const had = this.pressed.has(action);
    this.pressed.delete(action);
    return had;
  }

  /** Builds the control snapshot for one simulation step (consumes the suction toggle). */
  sample(): ControlState {
    return {
      accelerate: this.held.has('accelerate'),
      brake: this.held.has('brake'),
      thrust: this.held.has('thrust'),
      forwardThrust: this.held.has('forwardThrust'),
      rollLeft: this.held.has('rollLeft'),
      rollRight: this.held.has('rollRight'),
      steerLeft: this.held.has('steerLeft'),
      steerRight: this.held.has('steerRight'),
      toggleSuction: this.consumePress('suction'),
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
