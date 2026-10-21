import { useEffect, useRef, useState } from 'react';
import { MenuScene } from '../render/menuScene';

export interface MainMenuProps {
  onStart: () => void;
  seed?: number;
}

/** Space is handled by Game; this button supplies pointer and native Enter activation. */
export function MainMenu({ onStart, seed }: MainMenuProps) {
  const preview = useRef<HTMLSpanElement>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  useEffect(() => {
    if (!preview.current) return;
    try {
      const scene = new MenuScene(preview.current);
      return () => scene.dispose();
    } catch {
      setPreviewFailed(true);
    }
  }, []);

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
          <span className="main-menu__start"><kbd>SPACE</kbd><span>TO DRIVE</span><span className="main-menu__arrow" aria-hidden="true">↗</span></span>
          <span className="main-menu__click-hint">or click the roadster</span>
        </button>

        <div className="main-menu__controls" aria-label="Driving controls">
          <span><kbd>SPACE</kbd> Lift</span>
          <span><kbd>← →</kbd> Roll</span>
          <span><kbd>HOLD E</kbd> Suction</span>
          <span><kbd>A D</kbd> Steer</span>
        </div>
      </div>

      <footer className="main-menu__footer">
        <span>Automatic cruise. You choose the surface.</span>
        {seed !== undefined && <span className="main-menu__seed">COURSE {seed}</span>}
      </footer>
    </main>
  );
}
