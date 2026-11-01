import { describe, expect, it } from 'vitest';
import { InputManager } from '../src/game/input';

describe('touch input', () => {
  it('holds actions per touch source, with one press edge per action', () => {
    const input = new InputManager();
    input.press('lift', 'thrust');
    expect(input.sample().thrust).toBe(true);
    expect(input.consumePress('thrust')).toBe(true);
    // A second finger on an already held action is not a new press.
    input.press('lift-2', 'thrust');
    expect(input.consumePress('thrust')).toBe(false);
    input.release('lift');
    expect(input.sample().thrust).toBe(true);
    input.release('lift-2');
    expect(input.sample().thrust).toBe(false);
  });

  it('routes the turn pad to steering on a surface and to roll in the air', () => {
    const input = new InputManager();
    input.press('pad', 'turnLeft');
    expect(input.sample(false)).toMatchObject({ steerLeft: true, rollLeft: false });
    expect(input.sample(true)).toMatchObject({ steerLeft: false, rollLeft: true });
    // Sliding the finger across switches sides without lifting.
    input.press('pad', 'turnRight');
    expect(input.sample(true)).toMatchObject({ rollLeft: false, rollRight: true });
  });

  it('drops touch holds when input is cleared, as on blur or at the start of a run', () => {
    const input = new InputManager();
    input.press('suction', 'suction');
    input.clear();
    expect(input.sample().suction).toBe(false);
    input.press('suction', 'suction');
    input.clearUntilRelease();
    expect(input.sample().suction).toBe(false);
  });
});
