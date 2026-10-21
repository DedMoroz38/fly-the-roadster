import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game/Game';
import { FAIL_TEXT, SessionSnapshot } from '../game/session';

const SUCTION_LABEL: Record<string, string> = {
  off: 'OFF',
  searching: 'ON · NO SURFACE',
  attracting: 'PULLING',
  attached: 'ATTACHED',
};

export function useSnapshot(game: Game | null): SessionSnapshot | null {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  useEffect(() => (game ? game.subscribe(setSnap) : undefined), [game]);
  return snap;
}

const CONTROLS: [string, string][] = [
  ['W', 'Accelerate'],
  ['S', 'Brake / reverse'],
  ['Space', 'Main thrusters (push away from wheels)'],
  ['↑', 'Forward thruster (boost)'],
  ['← / →', 'Barrel roll in the air · steer on a surface'],
  ['A / D', 'Steer on a surface'],
  ['E', 'Toggle suction'],
  ['R', 'Restart'],
  ['Esc', 'Pause'],
  ['H', 'Show / hide this help'],
];

function HelpPanel({ ready }: { ready: boolean }) {
  return (
    <div className="panel help">
      <h1>Fly the Roadster</h1>
      <p className="tagline">Drive, fly, roll and stick your way down an endless corridor.</p>
      <table>
        <tbody>
          {CONTROLS.map(([k, a]) => (
            <tr key={k}>
              <td><kbd>{k}</kbd></td>
              <td>{a}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="tips">
        <li>Floors hold you by gravity. Walls and ceilings need <b>suction</b> (E) with the wheels facing them.</li>
        <li>Thrusters push away from the wheels — roll first to aim them. Fuel lasts about 5 s.</li>
        <li>Grab the green <span className="fuel-word">fuel cells</span> to refill.</li>
      </ul>
      <p className="cta">{ready ? 'Press W to start' : 'Press H or Esc to resume'}</p>
    </div>
  );
}

export function Hud({ game }: { game: Game | null }) {
  const s = useSnapshot(game);
  const [flash, setFlash] = useState(false);
  const lastRefuels = useRef(0);
  useEffect(() => {
    if (!s) return;
    if (s.refuels > lastRefuels.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 450);
      lastRefuels.current = s.refuels;
      return () => clearTimeout(t);
    }
    lastRefuels.current = s.refuels;
  }, [s?.refuels]);
  if (!s) return <div className="hud"><div className="loading">Loading…</div></div>;

  const fuelPct = Math.round(s.fuel * 100);
  return (
    <div className={`hud ${flash ? 'refuel-flash' : ''}`}>
      <div className="hud-top">
        <div className="stat distance">
          <span className="value">{Math.floor(s.distance)}</span>
          <span className="unit">m</span>
        </div>
        <div className="stat small">
          <span className="label">BEST</span> {Math.floor(s.best)} m
        </div>
        <div className="stat small">
          <span className="label">SPEED</span> {Math.round(Math.max(0, s.speed) * 3.6)} km/h
        </div>
      </div>

      <div className="hud-bottom">
        <div className={`fuel ${s.fuelEmpty ? 'empty' : fuelPct < 25 ? 'low' : ''}`}>
          <span className="label">FUEL</span>
          <div className="bar"><div className="fill" style={{ width: `${fuelPct}%` }} /></div>
          <span className="pct">{s.fuelEmpty ? 'EMPTY' : `${fuelPct}%`}</span>
        </div>
        <div className={`suction suction-${s.suctionState}`}>
          <span className="label">SUCTION</span>
          <span className="dot" />
          <span className="state">{SUCTION_LABEL[s.suctionState] ?? s.suctionState}</span>
        </div>
      </div>

      <div className="seed">seed {s.seed}</div>

      {s.helpOpen && <div className="overlay"><HelpPanel ready={s.state === 'ready'} /></div>}
      {s.state === 'paused' && !s.helpOpen && (
        <div className="overlay">
          <div className="panel">
            <h2>Paused</h2>
            <p>Esc to resume · R to restart · H for help</p>
          </div>
        </div>
      )}
      {s.state === 'gameover' && (
        <div className="overlay">
          <div className="panel gameover">
            <h2>{s.failReason ? FAIL_TEXT[s.failReason] : 'Game over'}</h2>
            <div className="final"><span className="value">{Math.floor(s.distance)}</span> m</div>
            <p>Best: {Math.floor(s.best)} m</p>
            <p className="cta">Press R to try again</p>
          </div>
        </div>
      )}
    </div>
  );
}
