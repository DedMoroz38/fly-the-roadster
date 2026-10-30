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
| Hold Shift | Engage suction; release to let go and cool |
| R | Restart (same seed) |
| Esc | Pause |
| M | Main menu (while paused or after a crash; also a button on both screens) |
| H | Help overlay |
| F3 | Toggle physics telemetry and the intended route |

Cruise starts at 24 m/s and rises with difficulty to 36 m/s; W adds up to 8 m/s on top. There are no braking or reversing controls.
Forces and torques drive the dynamic body, including roll against ground contact. Pitch and yaw
are locked. A/D steer independently on surfaces; the arrows fire the visible roll-thruster pairs.

Floors support the car by gravity. Walls and ceilings need Shift held for suction with the wheels facing them.
Attraction requires a surface within 3 m; attachment requires a gap of at most 0.4 m and alignment.
Acceleration, lift, roll and suction share a 2.5-unit tank (2.5 s of lift). W / ↑ consumes 0.4 units/s;
automatic cruise remains free, including with an empty tank. Each chunk has one green fuel cell near
its start, collected before its first maneuver; it refills the tank.
Landing on the roof ends the run. Airborne barrel rolls and wheels-first ceiling attachment are safe.

Suction heats at 24 units/s on every surface and in the air; floor suction also uses extra fuel and
adds drag. The HUD warns at 75, locks suction off at 100, and allows reactivation below 35.
Releasing Shift cools at 18 units/s. If Shift stays held through an overheat, suction resumes only after heat
drops below 35 and fuel is available. A held wall or ceiling run therefore lasts about 4 seconds.

Letting go of a ceiling, the car drops as usual. For 1.5 s afterwards, suction reaches 8 m back to
that ceiling (instead of 3 m) and pulls at up to 100 m/s² (instead of 55), so holding Shift again
recovers from a drop of several metres. This is the margin that makes ceiling bars passable.

## Score

You earn 1 point per metre of furthest progress. Full rolls in a single airborne stretch pay a bonus
when you land safely: 100 × flips², so 1 flip pays 100, 2 pay 400 and 3 pay 900. A landing up to 25°
short of the last roll still counts. Crashing or landing on the roof forfeits that jump's bonus.
Tune it in `CONFIG.score`.

## Vehicles

Pick a vehicle on the main menu with ‹ › or ← →; the choice is remembered in this browser. Every
vehicle uses the same physics body and handling, so only the look changes. Models load on first
selection, are turned to face forward, and are scaled to the physics body's length (capped at 1.6 m
tall and 2.1 m wide). Wheels spin where a model has wheel nodes, and the dino's walk plays faster
with speed. The models are slightly taller than the collider, so a roof can visually overlap low
geometry without touching it.

| Vehicle | Model | Credit (CC BY 4.0) |
| --- | --- | --- |
| Fast Charger | `models/car.glb` | project asset |
| Tesla Roadster | `models/tesla_roadster_2026.lite.glb` | “Tesla Roadtser 2026” by asiphy007 |
| Cybertruck | `models/tesla_cybertruck.glb` | “Tesla Cybertruck” by Lexyc16 |
| DeLorean | `models/delorean_time_machine_-_flying_mode.glb` | “DeLorean Time Machine - Flying Mode” by Sea Land Air |
| Chrome Dino | `models/3d_chrome_dino_walking.glb` | “3D Chrome Dino Walking” by MayMax |
| Steve in a Boat | `models/steve_in_a_boat.glb` (water tiles removed at load) | “Steve In A Boat” by CalebChaffee |

The menu shows the credit and Sketchfab link for the selected model. The original Roadster scan
(28.6 MB, 500k triangles) is not shipped; `scripts/bake-vertex-colors.mjs` bakes its texture into
vertex colours and simplifies it to the 0.5 MB, 40k-triangle file the game loads. Add a vehicle in
`src/render/vehicles.ts`.

## Worlds

A world restyles the track and supplies its surroundings; the course, physics and validation are
the same in every world. Vehicles pick their world in `src/render/vehicles.ts`; worlds live in
`src/render/worlds.ts`.

- **Neon** (default): the synthwave grid and star shell.
- **Voxel sky islands** (Steve in a Boat): a Minecraft-style sunset world, all generated in code.
  - Track: the floor is a flowing water channel in stone-brick sides (Steve is in a boat) with
    submerged sea-lantern lane lights. The ceiling is purpur, the walls are prismarine (left) and
    terracotta (right) with glowing block trims.
  - Contrast: a fill light from behind the camera lights the side of the vehicle you see, and the
    car light is dimmed so the water does not mirror it.
  - Hazards: obsidian blocks, crying-obsidian gates and TNT barriers. Fuel cells are emerald blocks
    with orbiting experience orbs.
  - Scenery: floating islands with trees, cottages with lit windows, lanterns, hanging vines,
    waterfalls, creepers, zombies, skeletons, spiders and ghasts, plus clouds above and a cloud sea
    below. It drifts past at 10% of the car's speed. Hazy snow-capped ranges drift at 3%.
  - Sky: a gradient sky with stars, a Milky Way band and a square sun, finished with a bloom pass.
  - Menu: the turntable becomes a floating island with a pond, and the boat floats on it.

Scenery is visual only and never collides. Tiles are generated from the run seed and tile index (the
same seed gives the same world), built at most one per frame at the far edge, and dropped behind.
Textures are 16×16 pixel art generated in `src/render/voxel/textures.ts`. Islands are meshed with
face culling and baked corner shading (`mesher.ts`).

## Terrain and validation

The generator chooses a bounded movement plan before publishing geometry. Each candidate is replayed
through the same Rapier vehicle controller with real fuel, heat, pickups, gravity, roll and collisions.
Accepted exit states feed the next candidate. Failed candidates have bounded retries and a separately
validated recovery-road fallback. No controller drives the player's car; validation inputs stay in the
worker and tests.

Supported procedural families are floor runs, short flight gaps, ceiling crossings, either wall,
ceiling-to-wall transitions (mirrored to either wall, with a short floor leg between them so suction
can cool), extended surface-free flight, and barrier jumps: 1–3 full-width floor barriers, 1–2 m
tall, cleared with a lift pulse and no suction. Barrier count and height rise with difficulty.
Ceiling runs (including the ceiling leg of a transition) may carry a full-width bar, 0.6 m deep,
hanging from the ceiling. The chance is 30% at difficulty 0 and 100% at difficulty 1, one bar per run.
It is passed by releasing Shift about 0.5 s before the bar, dropping under it, and holding Shift
again as the nose reaches it. Re-engaging anywhere from 0.15 s before to 0.35 s after that moment
still re-attaches. Keeping suction on crashes into it. The bar comes 1 s after attaching
(it is in view during the climb), rather than a full reaction interval, which would overheat suction
before the run ends. Seeded
obstacles mount on floors, ceilings and both walls, including the opening road. Their physical
colliders are part of world generation: placement respects the intended route and reaction margins,
then the complete decorated chunk is replayed and validated again. Unreachable additions are rejected.

Floor stretches weave: run-ups, recovery roads, the floor between barrier jumps and floor runs all
change lanes wherever a lane change fits, and obstacles fill the lanes the route leaves, so A/D
steering is required. Launches from the floor keep their lane (gaps and long flights recentre first).
Past the opening, every run-up is long enough for at least one lane change.

The reaction interval runs from the latest touchdown, carried across chunk boundaries. It and the
recovery floor after the last maneuver shrink with difficulty: 2 s → 1.2 s and 2 s → 1.4 s
(at least 1.7 s after a wall or ceiling run, so suction can cool). Wall/ceiling traversals are
80–93 m at base speed: long enough for the reaction interval after attaching, short enough to finish
before suction overheats. Every planner distance scales with the chunk's top speed, so maneuvers keep
the same timing as the car gets faster. On seeds 1/42/233/2804205951 over 4 km, plain floor
(not weaving, jumping, on a surface or in the air) is about 42–47% of route time, and most of it carries
gates or obstacles.

The opening road is 110–130 m and leads into two requested challenge chunks. Every 5th chunk is a
forced floor run until difficulty reaches 0.8 (about 2 km); the 5% chance of an extra one fades to
zero at difficulty 1. Difficulty is `1 − exp(−√(distance / 670 m))`: about 42% at 200 m, 58% at
500 m, 70% at 1 km, 82% at 2 km and 93% at 5 km. It sets each chunk's cruise speed (24 → 36 m/s,
about 86 → 130 km/h), the challenge mix, gap and flight lengths, barrier count and height, slalom
tightness (lane changes up to 30% closer), low full-width barriers inside floor runs (up to 2,
0.8–1.2 m tall), gates (0 → 3 per chunk, wall-to-wall boxes with one opening at the route's lane),
and hazard density (floor 4 → 9 obstacles per chunk, walls/ceilings 2 → 4, spacing down by about
a third). If a decorated chunk fails validation, it is retried without gates before falling back to
the undecorated route.

The validation contract includes the chunk's reaction interval, ±0.15 s action/suction timing
checks, and entry speeds from the chunk's cruise to its top speed. Timing variants allow ordinary steering corrections on
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
- Templates: `normal`, `gap`, `ceiling`, `wall-left`, `wall-right`, `multiple`, `flight`, `hurdle`.
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

## Deploy

The `Dockerfile` builds the Vite bundle and serves `dist/` with nginx on `$PORT` (default 8080).
`railway.toml` tells Railway to use it. Deploy the linked service with `railway up`.

```bash
docker build -t fly-the-roadster . && docker run -p 8080:8080 fly-the-roadster
```

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
