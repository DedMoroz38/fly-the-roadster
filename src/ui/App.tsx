import { useEffect, useRef, useState } from 'react';
import { Game } from '../game/Game';
import { Hud } from './Hud';

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const g = new Game(hostRef.current!);
    (window as unknown as { __game: Game }).__game = g;
    let alive = true;
    g.start().then(() => alive && setGame(g)).catch((err: unknown) => {
      if (alive) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      alive = false;
      g.dispose();
    };
  }, []);
  return (
    <>
      <div ref={hostRef} className="game-host" />
      <Hud game={game} />
      {error && <div className="overlay"><div className="panel" role="alert">Unable to prepare the road: {error}. Reload to retry.</div></div>}
    </>
  );
}
