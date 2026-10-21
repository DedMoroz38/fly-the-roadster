# Fly the Roadster V2

Browser 3D physics platformer: a roadster cruises automatically through a seeded, endless corridor
of floors, ceilings, walls and flight gaps. Use lift, barrel rolls and suction to follow a reachable
route while managing fuel and heat.

Built with TypeScript, Three.js, Rapier (`@dimforge/rapier3d-compat`), React and Vite.

## Run

```bash
npm ci
npm run dev        # http://localhost:5173  (add ?seed=123 for a repeatable course)
npm test -- --maxWorkers=2  # unit, real-physics and long-distance regressions
npm run build      # typecheck + production build
```

Tested with Node 22.23.4. The long-distance generation test can take about a minute.
After the first 400 m of terrain are validated in a Web Worker (generation continues behind the
menu), the main menu displays a 3D roadster on a turntable. It keeps spinning with reduced motion
enabled, just slower and without bobbing. Press Space or click the car to start. The world stays stopped until then; the start
keypress is consumed so it cannot also fire the lift thrusters.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate using fuel; release to return toward cruise speed |
| Space | Main thrusters (push away from the wheels) |
| ← / → | Roll torque on every surface and in the air |
| A / D | Steer on a surface |
| Hold E | Engage suction; release to let go and cool |
| R | Restart (same seed) |
| Esc | Pause |
| H | Help overlay |
| F3 | Toggle physics telemetry and the intended route |

Cruise is 24 m/s; acceleration approaches 32 m/s. There are no braking or reversing controls.
Forces and torques drive the dynamic body, including roll against ground contact. Pitch and yaw
are locked. A/D steer independently on surfaces; the arrows fire the visible roll-thruster pairs.

Floors support the car by gravity. Walls and ceilings need E held for suction with the wheels facing them.
Attraction requires a surface within 2.5 m; attachment requires a gap of at most 0.4 m and alignment.
Acceleration, lift, roll and suction share a five-unit tank. W / ↑ consumes 0.4 units/s;
automatic cruise remains free, including with an empty tank. Green cells refill it.
Landing on the roof ends the run. Airborne barrel rolls and wheels-first ceiling attachment are safe.

Floor suction heats at 24 units/s, uses extra fuel and adds drag. Wall/ceiling suction heats at
1.5 units/s. The HUD warns at 75, locks suction off at 100, and allows reactivation below 35.
Releasing E cools at 18 units/s. If E stays held through an overheat, suction resumes only after heat
drops below 35 and fuel is available. Wall and ceiling traversal remain practical for extended periods.

## Terrain and validation

The generator chooses a bounded movement plan before publishing geometry. Each candidate is replayed
through the same Rapier vehicle controller with real fuel, heat, pickups, gravity, roll and collisions.
Accepted exit states feed the next candidate. Failed candidates have bounded retries and a separately
validated recovery-road fallback. No controller drives the player's car; validation inputs stay in the
worker and tests.

Supported procedural families are floor runs, short flight gaps, ceiling crossings, either wall,
ceiling-to-wall transitions (mirrored to either wall), and extended surface-free flight. Seeded
obstacles mount on floors, ceilings and both walls, including the opening road. Their physical
colliders are part of world generation: placement respects the intended route and reaction margins,
then the complete decorated chunk is replayed and validated again. Unreachable additions are rejected.

Pacing keeps the car off plain floor for most of a run. Floor runs are slaloms: the certified route
weaves between lanes and obstacles fill the centre lanes it vacates, so A/D steering is required.
The 2 s reaction interval is measured from the latest touchdown, carried across chunk boundaries,
so lead-ins are only as long as that interval needs. Recovery after a maneuver is 2 s at top speed,
and wall/ceiling traversals are 150–210 m. On seeds 1/42/233/7/19 over 4 km, plain floor is 32–41%
of route time (plus 6–11% slalom), versus 71–81% floor before this tuning.
The opening road is 110–130 m and leads into two requested challenge chunks; the first maneuver
arrives after roughly 6–7.5 seconds. Difficulty values over the first kilometre are 50% higher than
the earlier tuning (about 28% at 500 m and 42% at 1 km) and keep increasing afterward.

The validation contract includes a minimum 2 s preparation interval, ±0.15 s action/suction timing
checks, and entry speeds of 24/28/32 m/s. Timing variants allow ordinary steering corrections on
supported surfaces. Each chunk returns to a stable, centred floor state with recovered suction and
fuel reserve. These checks establish feasible intended routes within those margins; they do not
certify arbitrary player inputs, every lift duration, or sustained acceleration through a maneuver.

Generation runs ahead in a worker. Old plans, geometry and pickups are removed; contiguous surface
colliders are joined to avoid seam kicks. Physics and rendering rebase every 256 m while logical
distance stays continuous. If the worker falls behind, simulation waits safely for the next buffer.

## Reproduce and inspect

- `/?seed=42&debug=1` — repeatable course with speed, fuel, heat, attachment, difficulty, chunk seed,
  validation margins and route overlay.
- `/?seed=42&debug=1&template=ceiling` — force one procedural challenge family.
- Templates: `normal`, `gap`, `ceiling`, `wall-left`, `wall-right`, `multiple`, `flight`.
- R restarts the same seed and template. F3 toggles debug information during play.

Tune movement/resources in `src/game/config.ts`, maneuver limits in
`src/game/course/plannerConfig.ts`, progression/streaming in `generatorConfig.ts`, and optional
geometry in `decorator.ts`.

Regression coverage includes the explicit menu start, held suction/release, acceleration fuel
sharing/exhaustion, roof landing failure, faster opening pacing, all-surface obstacle placement,
all challenge families at maximum configured difficulty, impossible
candidate rejection, three continuous mixed 6 km routes, 50 km of bounded generation, and a 100 km
continuous normal-road replay. Origin tests compare physics at 0, 50 km and 10 million logical metres;
render tests preserve fractional geometry at 1 billion metres. These are engineering checks, not an
exhaustive proof over every seed and possible input.

## Layout

```
src/core/          seeded RNG, fixed-step accumulator, math helpers
src/game/          rules & physics (no rendering): config, input, fuel, suction rule,
                   session (state/score/failure), simulation, physics/vehicle, physics/level
src/game/course/   movement planner, physics validator, seeded generator, worker and streaming
src/render/        Three.js renderer: car model, surfaces, pickups, camera rig
src/ui/            React app, HUD and overlays
tests/             Vitest suites and fixed recorded maneuver replays through real physics
```

See [INCREMENTSV2.md](INCREMENTSV2.md) for the V2 increments, confidence gates and acceptance evidence.
The original implementation history remains in [INCREMENTS.md](INCREMENTS.md).
