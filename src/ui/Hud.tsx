import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game/Game';
import { FAIL_TEXT, flipPoints, SessionSnapshot } from '../game/session';
import { CONFIG } from '../game/config';
import { MainMenu } from './MainMenu';

const SUCTION_LABEL: Record<string, string> = {
  off: 'OFF',
  overheated: 'OVERHEATED · COOLING',
  'no-energy': 'UNAVAILABLE · NO FUEL',
  searching: 'ON · NO SURFACE',
  attracting: 'PULLING',
  attached: 'ATTACHED',
};

export function useSnapshot(game: Game | null): SessionSnapshot | null {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  useEffect(() => (game ? game.subscribe(setSnap) : undefined), [game]);
  return snap;
}

const FLIP_NAME: Record<number, string> = { 1: 'Flip', 2: 'Double flip', 3: 'Triple flip', 4: 'Quad flip' };

const CONTROLS: [string, string][] = [
  ['W / ↑', 'Accelerate (uses fuel) · release to cruise'],
  ['Space', 'Main thrusters (push away from wheels)'],
  ['← / →', 'Roll left / right (also works on the floor)'],
  ['A / D', 'Steer on a surface'],
  ['Hold E', 'Engage suction · release to let go'],
  ['R', 'Restart'],
  ['Esc', 'Pause'],
  ['H', 'Show / hide this help'],
  ['F3', 'Route and physics debug view'],
];

const CHALLENGE_LABEL: Record<string, string> = {
  normal: 'Floor run', gap: 'Flight gap', ceiling: 'Ceiling crossing',
  'wall-left': 'Left wall crossing', 'wall-right': 'Right wall crossing',
  multiple: 'Surface transitions', flight: 'Extended flight', hurdle: 'Barrier jumps',
};

/** Detailed telemetry is opt-in; the upcoming maneuver remains visible in normal play. */
export function DebugPanel({ snapshot: s }: { snapshot: SessionSnapshot }) {
  if (!s.debugEnabled) return null;
  const d = s.debug;
  return (
    <aside className="debug-panel" aria-label="Physics and route debug">
      <div className="debug-title">PHYSICS + ROUTE <span>F3 to hide</span></div>
      <dl>
        <dt>Speed / forward</dt><dd>{s.totalSpeed.toFixed(2)} / {s.forwardVelocity.toFixed(2)} m/s</dd>
        <dt>Fuel</dt><dd>{(s.fuel * CONFIG.fuel.capacity).toFixed(2)} / {CONFIG.fuel.capacity.toFixed(1)}</dd>
        <dt>Suction / heat</dt><dd>{s.suctionOn ? 'ON' : 'OFF'} · {s.suctionHeat.toFixed(1)} / {CONFIG.suction.criticalHeat}</dd>
        <dt>Attachment</dt><dd>{s.surface ?? 'none'} · {s.mode}</dd>
        {d && <>
          <dt>Difficulty</dt><dd>{Math.round(d.difficulty * 100)}%</dd>
          <dt>Chunk / seed</dt><dd>{d.chunkId} / {d.chunkSeed}</dd>
          <dt>Challenge</dt><dd>{d.kind}</dd>
          <dt>Route validation</dt><dd className={d.validated ? 'debug-valid' : 'debug-invalid'}>{d.validated ? 'PASSED' : 'REJECTED'}</dd>
          <dt>Route fuel / heat</dt><dd>min {d.minFuel.toFixed(2)} · max {d.maxHeat.toFixed(1)}</dd>
          <dt>Current phase</dt><dd>{d.phase}</dd>
          <dt>Generated ahead</dt><dd>{Math.max(0, Math.round(d.frontier - s.distance))} m</dd>
        </>}
      </dl>
      {d && <div className="debug-next">Next: {d.nextAction}</div>}
      <div className="debug-legend"><span /> Validated movement route</div>
    </aside>
  );
}

function HelpPanel() {
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
        <li>Floors hold you by gravity. On walls and ceilings, <b>hold E for suction</b> with the wheels facing them.</li>
        <li>Lift thrusters push away from the wheels — roll first to aim them. A full tank provides {CONFIG.fuel.capacity} s of lift.</li>
        <li>Grab the green <span className="fuel-word">fuel cells</span> to refill. Acceleration, lift, roll and suction share fuel.</li>
        <li>Release E on the floor to cool and avoid drag. Overheated suction stays off until heat drops below {Math.round(CONFIG.suction.recoveryHeat / CONFIG.suction.criticalHeat * 100)}%; holding E then engages it again.</li>
        <li>Cruising is automatic and uses no fuel. Release W / ↑ to ease back to cruise speed.</li>
        <li>Landing on the roof ends the run. Roll upright before returning to the road.</li>
        <li>You score a point per metre. Full rolls in one jump pay a bonus on a safe landing: 1 flip {flipPoints(1)}, 2 flips {flipPoints(2)}, 3 flips {flipPoints(3)}.</li>
      </ul>
      <p className="cta">Press H or Esc to resume</p>
    </div>
  );
}

export function Hud({ game }: { game: Game | null }) {
  const s = useSnapshot(game);
  const [flash, setFlash] = useState(false);
  const lastRefuels = useRef(0);
  const [flip, setFlip] = useState<SessionSnapshot['lastFlip']>(null);
  useEffect(() => {
    if (!s?.lastFlip) { setFlip(null); return; }
    setFlip(s.lastFlip);
    const t = setTimeout(() => setFlip(null), 1400);
    return () => clearTimeout(t);
  }, [s?.lastFlip?.id]);
  useEffect(() => {
    if (!s) return;
    if (s.refuels > lastRefuels.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 450);
      lastRefuels.current = s.refuels;
      return () => clearTimeout(t);
    }
    setFlash(false);
    lastRefuels.current = s.refuels;
  }, [s?.refuels]);
  if (!s) return <div className="hud"><div className="loading">Loading…</div></div>;
  if (s.state === 'ready') return <MainMenu onStart={() => game?.startRun()} seed={s.seed} />;

  const fuelPct = Math.round(s.fuel * 100);
  const heatPct = Math.round(s.suctionHeat / CONFIG.suction.criticalHeat * 100);
  const heatWarning = s.suctionHeat >= CONFIG.suction.warningHeat;
  return (
    <div className={`hud ${flash ? 'refuel-flash' : ''}`}>
      <div className="hud-top">
        <div className="stat distance">
          <span className="value">{Math.floor(s.score)}</span>
          <span className="unit">pts</span>
        </div>
        <div className="stat small">
          <span className="label">BEST</span> {Math.floor(s.best)} pts
        </div>
        <div className="stat small">
          <span className="label">SPEED</span> {Math.round(Math.max(0, s.speed) * 3.6)} km/h
        </div>
      </div>

      {s.debug && <div className="route-cue">
        <span className="label">{CHALLENGE_LABEL[s.debug.kind] ?? s.debug.kind}</span>
        <strong>{s.debug.nextAction || s.debug.phase}</strong>
      </div>}
      {flip && <div key={flip.id} className="flip-award" role="status">
        <span className="flip-name">{FLIP_NAME[flip.flips] ?? `${flip.flips}× flip`}</span>
        <span className="flip-points">+{flip.points}</span>
      </div>}
      {s.terrainStatus && <div className="terrain-status" role="status">{s.terrainStatus}</div>}
      <DebugPanel snapshot={s} />

      <div className="hud-bottom">
        <div className={`fuel ${s.fuelEmpty ? 'empty' : fuelPct < 25 ? 'low' : ''}`}>
          <span className="label">FUEL</span>
          <div className="bar"><div className="fill" style={{ width: `${fuelPct}%` }} /></div>
          <span className="pct">{s.fuelEmpty ? 'EMPTY' : `${fuelPct}%`}</span>
        </div>
        <div className={`heat ${s.suctionOverheated ? 'locked' : heatWarning ? 'warning' : ''}`}>
          <span className="label">SUCTION HEAT</span>
          <div className="bar" role="progressbar" aria-label="Suction heat" aria-valuenow={heatPct} aria-valuemin={0} aria-valuemax={100}>
            <div className="fill" style={{ width: `${heatPct}%` }} />
          </div>
          <span className="pct">{heatPct}%</span>
          <span className="heat-notice" role="status">{s.suctionOverheated ? 'LOCKED · COOLING' : heatWarning ? 'HEAT CRITICAL' : ''}</span>
        </div>
        <div className={`suction suction-${s.suctionState}`}>
          <span className="label">SUCTION</span>
          <span className="dot" />
          <span className="state">{SUCTION_LABEL[s.suctionState] ?? s.suctionState}</span>
        </div>
      </div>

      <div className="seed">seed {s.seed}</div>
      <div className="control-hint">AUTO CRUISE · Space lift · ← → roll · Hold E suction · H help · F3 debug</div>

      {s.helpOpen && <div className="overlay"><HelpPanel /></div>}
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
            <div className="final"><span className="value">{Math.floor(s.score)}</span> pts</div>
            <p>{Math.floor(s.distance)} m · Best: {Math.floor(s.best)} pts</p>
            <p className="cta">Press R to try again</p>
          </div>
        </div>
      )}
    </div>
  );
}
