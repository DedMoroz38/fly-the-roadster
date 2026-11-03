import { useEffect, useRef, useState } from 'react';
import { MenuScene, type DemoState } from '../render/menuScene';
import { marsPropCredits } from '../render/mars/props';
import { AUDIENCE_CREDITS } from '../render/menuDemo';
import { orbitCredits } from '../render/orbit/spaceProps';
import { CC_BY, vehicleById, vehicleWorld, type VehicleCredit } from '../render/vehicles';
import type { WorldId } from '../render/worlds';

/** Credits for the downloaded models a world shows, under a label. */
function sceneryCredits(world: WorldId): { label: string; credits: VehicleCredit[] } | null {
  if (world === 'mars') return { label: 'Mars scenery', credits: marsPropCredits() };
  if (world === 'orbit') return { label: 'In orbit', credits: orbitCredits() };
  return null;
}

const License = ({ credit }: { credit: VehicleCredit }) => {
  const license = credit.license ?? CC_BY;
  return <a href={license.url} target="_blank" rel="noopener noreferrer">{license.label}</a>;
};

export interface MainMenuProps {
  onStart: () => void;
  seed?: number;
  vehicleId: string;
  /** Moves the selection by ±1 through the vehicle list. */
  onCycleVehicle: (step: number) => void;
  /** Phone layout: tap wording and the on-screen controls in place of keys. */
  touch?: boolean;
}

/** Space is handled by Game; this button supplies pointer and native Enter activation. */
export function MainMenu({ onStart, seed, vehicleId, onCycleVehicle, touch = false }: MainMenuProps) {
  const preview = useRef<HTMLSpanElement>(null);
  const scene = useRef<MenuScene | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [demo, setDemo] = useState<DemoState>('idle');
  useEffect(() => {
    if (!preview.current) return;
    try {
      const menuScene = new MenuScene(preview.current, vehicleId);
      scene.current = menuScene;
      menuScene.onDemoChange(setDemo);
      return () => { menuScene.dispose(); scene.current = null; };
    } catch {
      setPreviewFailed(true);
    }
    // The showroom is built once; vehicle changes are applied below without rebuilding it.
  }, []);
  useEffect(() => { scene.current?.setVehicle(vehicleId); }, [vehicleId]);
  // While the show runs the page is just the show: Esc stops it, and so does a click anywhere.
  useEffect(() => {
    if (demo !== 'playing') return;
    const stop = (event: KeyboardEvent) => { if (event.code === 'Escape') scene.current?.cancelDemo(); };
    window.addEventListener('keydown', stop);
    return () => window.removeEventListener('keydown', stop);
  }, [demo]);
  const vehicle = vehicleById(vehicleId);
  const scenery = sceneryCredits(vehicleWorld(vehicle.id));

  return (
    <main className={`main-menu${demo === 'playing' ? ' main-menu--demo' : ''}`} aria-labelledby="main-menu-title"
      onClick={demo === 'playing' ? () => scene.current?.cancelDemo() : undefined}>
      <header className="main-menu__topline">
        <span className="main-menu__brand"><span className="main-menu__mark" aria-hidden="true">F/R</span> FLY THE ROADSTER</span>
        <span className="main-menu__edition">ENDLESS ARCADE · V2</span>
      </header>

      <div className="main-menu__content">
        <div className="main-menu__heading">
          <p className="main-menu__eyebrow">THE ROAD IS JUST THE START</p>
          <h1 id="main-menu-title"><span>Fly the</span> Roadster</h1>
          <p className="main-menu__tagline">Fly the gaps. Roll onto walls. Keep going.</p>
        </div>

        <button className="main-menu__launch" type="button" onClick={onStart} aria-label="Start Fly the Roadster">
          <span className={`main-menu__car${vehicle.demo ? ' main-menu__car--stage' : ''}`} ref={preview} aria-hidden="true">
            {previewFailed && <span className="main-menu__preview-fallback">Your roadster is ready.</span>}
          </span>
          <span className="main-menu__start">{touch ? <span>TAP TO DRIVE</span> : <><kbd>SPACE</kbd><span>TO DRIVE</span></>}<span className="main-menu__arrow" aria-hidden="true">↗</span></span>
          <span className="main-menu__click-hint">{touch ? 'Best in landscape' : `or click the ${vehicle.name}`}</span>
        </button>

        <div className="main-menu__garage" role="group" aria-label="Choose your vehicle">
          <button type="button" className="main-menu__pick" onClick={() => onCycleVehicle(-1)} aria-label="Previous vehicle">‹</button>
          <span className="main-menu__vehicle" aria-live="polite">{vehicle.name}</span>
          <button type="button" className="main-menu__pick" onClick={() => onCycleVehicle(1)} aria-label="Next vehicle">›</button>
          {/* Beside the picker, out of the flow, so the Roadster's menu is laid out exactly like the others. */}
          {vehicle.demo && (
            <button type="button" className="main-menu__demo" disabled={demo !== 'idle'}
              onClick={event => { event.currentTarget.blur(); void scene.current?.playDemo(); }}>
              {demo === 'loading' ? 'Loading demo…' : 'Show demo'}
            </button>
          )}
        </div>
        {/* A fixed height whatever the vehicle, so longer credits never move the car or the controls. */}
        <div className="main-menu__credits">
          <p className="main-menu__credit">
            {vehicle.credit
              ? <>Model: <a href={vehicle.credit.url} target="_blank" rel="noopener noreferrer">“{vehicle.credit.title}”</a> by {vehicle.credit.author} · <License credit={vehicle.credit} /></>
              : <>&nbsp;</>}
          </p>
          {scenery && scenery.credits.length > 0 && (
            <p className="main-menu__credit main-menu__credit--world">
              {scenery.label}: {scenery.credits.map((credit, i) => (
                <span key={credit.url}>{i > 0 && ', '}<a href={credit.url} target="_blank" rel="noopener noreferrer">“{credit.title}”</a> by {credit.author} (<License credit={credit} />)</span>
              ))}
              {vehicle.demo && <> · Demo cars: {AUDIENCE_CREDITS.map((credit, i) => (
                <span key={credit.url}>{i > 0 && ', '}<a href={credit.url} target="_blank" rel="noopener noreferrer">“{credit.title}”</a> by {credit.author} (<License credit={credit} />)</span>
              ))}</>}
            </p>
          )}
        </div>

        {touch ? (
          <div className="main-menu__controls" aria-label="Touch controls">
            <span><kbd>◀ ▶</kbd> Steer · roll in the air</span>
            <span><kbd>LIFT</kbd> Thrusters</span>
            <span><kbd>HOLD SUCTION</kbd> Stick to walls</span>
          </div>
        ) : (
          <div className="main-menu__controls" aria-label="Driving controls">
            <span><kbd>SPACE</kbd> Lift</span>
            <span><kbd>← →</kbd> Roll · pick vehicle here</span>
            <span><kbd>HOLD SHIFT</kbd> Suction</span>
            <span><kbd>A D</kbd> Steer</span>
          </div>
        )}
      </div>

      <footer className="main-menu__footer">
        <span>Automatic cruise. You choose the surface.</span>
        {seed !== undefined && <span className="main-menu__seed">COURSE {seed}</span>}
      </footer>
    </main>
  );
}
