import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { Action, InputManager } from '../game/input';

/** Touch layout: a coarse pointer (phones, tablets), or `?touch=1` to try it with a mouse. */
export function useTouchDevice(): boolean {
  const query = '(pointer: coarse)';
  const forced = new URLSearchParams(window.location.search).get('touch') === '1';
  const [coarse, setCoarse] = useState(() => forced || window.matchMedia?.(query).matches === true);
  useEffect(() => {
    if (forced || !window.matchMedia) return;
    const media = window.matchMedia(query);
    const change = () => setCoarse(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [forced]);
  return coarse;
}

/** On a phone, starting a run goes fullscreen and landscape where the browser allows it (not iOS Safari). */
export function enterTouchFullscreen() {
  const root = document.documentElement;
  if (document.fullscreenElement || !root.requestFullscreen) return;
  root.requestFullscreen({ navigationUI: 'hide' })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => undefined);
}

let nextSource = 0;

/** Every finger on a control holds one action until it lifts; capture keeps it while the finger slides. */
function useTouchSources(input: InputManager) {
  const prefix = useRef(`touch${nextSource++}`);
  const active = useRef(new Set<string>());
  useEffect(() => () => { for (const source of active.current) input.release(source); active.current.clear(); }, [input]);
  return {
    hold(pointerId: number, action: Action) {
      const source = `${prefix.current}:${pointerId}`;
      active.current.add(source);
      input.press(source, action);
    },
    lift(pointerId: number) {
      const source = `${prefix.current}:${pointerId}`;
      active.current.delete(source);
      input.release(source);
    },
    get count() { return active.current.size; },
  };
}

function HoldButton({ input, action, className, children }: { input: InputManager; action: Action; className: string; children: ReactNode }) {
  const sources = useTouchSources(input);
  const [down, setDown] = useState(false);
  const start = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    sources.hold(e.pointerId, action);
    setDown(true);
  };
  const end = (e: ReactPointerEvent) => {
    sources.lift(e.pointerId);
    setDown(sources.count > 0);
  };
  return (
    <div role="button" aria-label={action} className={`touch-button ${className} ${down ? 'down' : ''}`}
      onPointerDown={start} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onContextMenu={e => e.preventDefault()}>
      {children}
    </div>
  );
}

/** One wide pad for the left thumb: the half under the finger turns that way, and sliding across switches. */
function TurnPad({ input }: { input: InputManager }) {
  const sources = useTouchSources(input);
  const [side, setSide] = useState<'left' | 'right' | null>(null);
  const fingers = useRef(new Map<number, 'left' | 'right' | null>());
  const track = (e: ReactPointerEvent) => {
    if (!fingers.current.has(e.pointerId)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const next = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
    if (fingers.current.get(e.pointerId) === next) return;
    fingers.current.set(e.pointerId, next);
    sources.hold(e.pointerId, next === 'left' ? 'turnLeft' : 'turnRight');
    setSide(next);
  };
  const start = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    fingers.current.set(e.pointerId, null);
    track(e);
  };
  const end = (e: ReactPointerEvent) => {
    fingers.current.delete(e.pointerId);
    sources.lift(e.pointerId);
    setSide([...fingers.current.values()].filter(Boolean).at(-1) ?? null);
  };
  return (
    <div className={`touch-pad ${side ? `touch-pad--${side}` : ''}`} role="group" aria-label="Steer on a surface, roll in the air"
      onPointerDown={start} onPointerMove={track} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onContextMenu={e => e.preventDefault()}>
      <span className="touch-pad__half touch-pad__half--left" aria-hidden="true">◀</span>
      <span className="touch-pad__half touch-pad__half--right" aria-hidden="true">▶</span>
      <span className="touch-pad__caption">STEER · ROLL IN AIR</span>
    </div>
  );
}

/**
 * Phone controls. Left thumb: the turn pad (steer on a surface, roll in the air: steering only works on
 * a surface and rolling is only needed off it). Right thumb: hold SUCTION and LIFT, with BOOST above.
 */
export function TouchControls({ input, onPause }: { input: InputManager; onPause: () => void }) {
  return (
    <div className="touch-controls">
      <button type="button" className="touch-pause" aria-label="Pause" onClick={onPause}>II</button>
      <TurnPad input={input} />
      <div className="touch-actions">
        <HoldButton input={input} action="accelerate" className="touch-boost">BOOST</HoldButton>
        <HoldButton input={input} action="suction" className="touch-suction">SUCTION</HoldButton>
        <HoldButton input={input} action="thrust" className="touch-lift">LIFT</HoldButton>
      </div>
    </div>
  );
}
