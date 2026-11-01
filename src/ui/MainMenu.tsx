import { useEffect, useRef, useState } from 'react';
import { MenuScene } from '../render/menuScene';
import { vehicleById } from '../render/vehicles';

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
  useEffect(() => {
    if (!preview.current) return;
    try {
      const menuScene = new MenuScene(preview.current, vehicleId);
      scene.current = menuScene;
      return () => { menuScene.dispose(); scene.current = null; };
    } catch {
      setPreviewFailed(true);
    }
    // The showroom is built once; vehicle changes are applied below without rebuilding it.
  }, []);
  useEffect(() => { scene.current?.setVehicle(vehicleId); }, [vehicleId]);
  const vehicle = vehicleById(vehicleId);

  return (
    <main className="main-menu" aria-labelledby="main-menu-title">
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
          <span className="main-menu__car" ref={preview} aria-hidden="true">
            {previewFailed && <span className="main-menu__preview-fallback">Your roadster is ready.</span>}
          </span>
          <span className="main-menu__start">{touch ? <span>TAP TO DRIVE</span> : <><kbd>SPACE</kbd><span>TO DRIVE</span></>}<span className="main-menu__arrow" aria-hidden="true">↗</span></span>
          <span className="main-menu__click-hint">{touch ? 'Best in landscape' : `or click the ${vehicle.name}`}</span>
        </button>

        <div className="main-menu__garage" role="group" aria-label="Choose your vehicle">
          <button type="button" className="main-menu__pick" onClick={() => onCycleVehicle(-1)} aria-label="Previous vehicle">‹</button>
          <span className="main-menu__vehicle" aria-live="polite">{vehicle.name}</span>
          <button type="button" className="main-menu__pick" onClick={() => onCycleVehicle(1)} aria-label="Next vehicle">›</button>
        </div>
        <p className="main-menu__credit">
          {vehicle.credit
            ? <>Model: <a href={vehicle.credit.url} target="_blank" rel="noopener noreferrer">“{vehicle.credit.title}”</a> by {vehicle.credit.author} · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></>
            : <>&nbsp;</>}
        </p>

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
