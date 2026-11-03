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

On phones and tablets (any coarse pointer; `?touch=1` forces it with a mouse) on-screen controls replace
the keys:

| Control | Action |
| --- | --- |
| ◀ ▶ pad (left thumb) | Steer on a surface, roll in the air; slide across to switch sides |
| SUCTION (right thumb) | Hold to engage, lift the thumb to let go |
| LIFT (right thumb) | Main thrusters |
| BOOST | Accelerate |
| II | Pause; resume, restart, main menu and the controls list are buttons there |

One pad covers both steering and roll, because steering only acts on a surface and the planned routes
only roll in the air. On Android, starting a run goes fullscreen and locks landscape. iOS Safari does
not allow either, and the menu suggests landscape. The menu switches to a two-column layout on
landscape phones, and the gauges move to the top, clear of both thumbs.

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

- **Mars at dusk** (Cybertruck): smooth, faceted desert scenery (no blocks), all generated in code
  except three optional downloaded models.
  - Track: a steel causeway. The deck is brushed steel plates with cyan light strips near both edges,
    and the walls and ceiling are satin steel with colour-coded strips. Metal reflects a blurred copy
    of the sky (an environment map made from the sky shader).
  - Hazards: white cargo crates with hazard-striped feet, steel gantry gates with cyan light bars,
    and chevron blast walls with blinking red beacons. Fuel cells are methane canisters.
  - Ground: the causeway crosses a dry channel deep enough that a falling car leaves play before it
    could touch the ground. Plains with boulders and rock outcrops stream past at the car's speed.
    Mesas, buttes, spires and the odd rock arch drift at 8%, and terraced canyon walls at 3%. Rock
    strata are drawn by the material in world height, so the bands stay level.
  - Sights, kept rare on purpose (an early settlement, not a city): near the track a rover early in
    every run, then about one rover, robot crew or fuel depot every 1.7 km. The rover is shown at
    twice life size and the robots at 1.5×, so they read from the road. Further out (167–287 m from
    the track), the opening always has a greenhouse outpost and, further ahead, a Starship landing
    site whose ship launches 250–400 m into the run, while it is still in front of the car. After
    that about 1 landmark tile in 12 holds a Starship site (half of them launch, once 480–600 m
    ahead) and 1 in 8 an outpost.
  - Sky: stars, the Milky Way, a small sun on the horizon in orange dust haze, drifting dust motes
    and a bloom pass.
  - Models: `models/mars/starship.glb`, `rover.glb` and `robot.glb` (Sketchfab, CC BY 4.0; credited
    in `src/render/mars/props.ts` and on the menu). Each is optional, and a missing file leaves that
    sight out. They are optimised copies of the downloads in `models/mars/source` (15.2 MB → 3.1 MB),
    made with gltf-transform 4.1.1 (`npm i @gltf-transform/cli@4.1.1` in a scratch folder):

    ```sh
    gltf-transform optimize source/starship.glb starship.glb --compress quantize --texture-compress webp --texture-size 512 --simplify false
    gltf-transform optimize source/rover.glb rover.glb --compress quantize --texture-compress webp --texture-size 512 --simplify-ratio 0.5 --simplify-error 0.001
    gltf-transform optimize source/robot.glb robot.glb --compress quantize --texture-compress false --simplify-ratio 0.12 --simplify-error 0.002
    ```

    The rover ships folded for cruise; its animation deploys it, so it is shown in the last frame.
  - Menu: the turntable becomes a small landing pad in red regolith.
  - Armour-glass demo (Cybertruck menu only, `src/render/menuArmory.ts`): a pistol and a steel ball
    hop on stands either side of the turntable. Click one to pick it up, click to shoot or throw at
    the cursor, and Esc, right-click or its stand puts it back. Space still starts the run. Shots
    lead the spinning car so they land where you clicked. Bullets ricochet off the body and the glass;
    each thrown ball (unlimited) cracks the glass where it hits. Bullets and balls are removed five
    seconds after they first land or drop off the pad. Cracks stay until the menu closes or the
    vehicle changes. The window material is named per vehicle (`armory.glass` in `vehicles.ts`).

- **Low Earth orbit** (Tesla Roadster): a station track in orbit above Earth.
  - Track: white deck plates with seams and bolt heads, solar-array walls and a gold-foil ceiling,
    with light strips in the shared colour coding. Hazards are the same cargo crates, gantries and
    blast walls as on Mars; fuel cells are lime propellant canisters.
  - Earth: NASA imagery (public domain) in `models/earth`: Blue Marble Next Generation (day; an
    8192-pixel map where the GPU supports it, else 4096), Black Marble 2012 (city lights on the night
    side) and the Blue Marble clouds. The shader adds fine detail the imagery is too coarse for (land
    relief, torn cloud edges and puffy cloud tops), cloud shadows, deep-blue oceans with sun glitter,
    a dawn band along the terminator, and haze that thickens with distance and toward the horizon,
    ending in a glowing blue limb. It sits 150 m below the track on a 9 km sphere, so the horizon
    dips about 10°, and turns beneath you at about a third of the car's speed. Each run starts over
    one of seven routes chosen by the seed (Mediterranean, Florida, Nile, India, Japan, Western
    Europe, Western Australia).
  - Sky: black space with sparse, steady stars, a faint Milky Way and a white sun in the upper left.
    A shooting star streaks across the upper sky every 2.5–7 s.
  - Visitors (`src/render/orbit/show.ts`): one at a time, each on screen for 500–700 m of travel,
    then 200–700 m of empty space before the next; the run opens with such a gap. Every kind
    appears once before any repeats, never twice in a row, in a new random order every run and every
    restart. None stands still: each follows its own path, close to the track (passing within
    40–200 m of the camera, clear of the corridor by more than its own size), that enters and
    leaves unseen: across the edge of the view, from behind the camera or out of the distance. The
    ISS drifts down from the upper right; a Space Shuttle crosses nose first; Voyager tumbles down
    on the left; Starman's 2011 Roadster overtakes on the right, tumbling; the Millennium Falcon
    swoops across, banking into its turn; the Endurance sinks into view spinning (a turn every
    12–13 s). WALL-E overtakes the car: from behind the camera he flies straight on along the left
    of the road until he is a speck far ahead, back first, away from his fire extinguisher, whose
    spray streams back towards you; EVE follows behind him, always facing him. Their path runs low
    enough that a ceiling overhead never hides them (a wall on the left still can, briefly).
  - Models: `models/space/*.glb` are optimised copies of the downloads in `models/space/source`
    (28.5 MB → 6.9 MB), made the same way as the Mars ones. Credits with each model's licence
    show on the menu. The 2011 Roadster and the Millennium Falcon are CC BY-NC-SA 4.0
    (non-commercial); the rest are CC BY 4.0. WALL-E, EVE, the Falcon and the Endurance are fan
    models of film designs, which suits this non-commercial project only.
  - Menu: the turntable becomes a station docking pad.
  - Stunt demo (Roadster menu only, a "Show demo" button beside the vehicle picker;
    `src/render/menuDemo.ts`), modelled on Tesla's October 2026 night demo: the Roadster drives at a
    row of parked Teslas, lifts off on its thrusters, flies over them with one full roll (Tesla's
    "kickflip") and lands upright. Four cars (a Tesla Semi, a Cybercab, the Cybertruck and a Model 3,
    left to right, from `models/space` and `models/`) are always parked behind the turntable on the
    Roadster's menu, side by side, touching, fronts on one line, back in a haze that leaves the
    turntable exactly as clear as every other vehicle's. Long red light strips run along the ground in
    front of them.
  - The menu looks the same for every vehicle: the button sits beside the picker, outside the flow,
    and the credits have a fixed-height area, so the title, the car, the start button and the controls
    are at the same place whichever vehicle is chosen. The Roadster's picture is drawn into a canvas
    that fills the page behind the menu, with the camera's projection widened so the box shows exactly
    what it shows for the others. Pressing the button fades the menu out and a black night in, and the
    camera moves down from the menu's view to a person's eye level, square to the row, with a long lens
    and the picture shifted up rather than tilted, as in the photographs. The car is the one on the
    turntable throughout, never redrawn elsewhere. A click or Esc ends the show.
  - The show: the turntable turns the car to face right and sets it down on the road; it drives off the
    right edge, comes back from the right speeding up, takes off before the row, flies over it with one
    roll, lands past the last car, leaves past the left edge, comes back in from the left and coasts to
    rest on the turntable, which turns it back to its spin. Every pass starts and ends beyond the edge
    of the picture, worked out from the window's shape, so the car never appears or vanishes in view.
    White cold-gas vapour comes from the lift and roll jets and smoke clouds blow off the road at
    take-off and touch-down (`menuVapour.ts`); the wheels turn with the ground.
  - The motion is the game's physics, not an animation. `stepCar` is the game's vehicle controller
    (`Vehicle.applyControls`) for a car on or above a flat road: automatic cruise (it accelerates at
    most at the game's 22 m/s² and, having no brakes, coasts to a stop at 3 m/s²), gravity, lift
    thrust along the car's up, tyre grip, the roll controller with its brake and settle assist, and
    fuel, stepped at 60 Hz the way Rapier integrates (4 substeps). The show is a recording of inputs a
    player has: a cruise speed, Space for the take-off burst, the roll key held for one full turn
    (started as the burst ends) and Space again to land. The lift fires only within 6° of upright,
    so nearly all of it lifts. The inputs are searched from the measured size of the cars so that the
    car clears every roof, upright or rolled over. Today that is 2.65 s in the air, 9.8 m high at the
    top and a touch-down at 1.9 m/s. A test replays the same inputs through the real Rapier vehicle:
    in the air it stays within 5 mm and a tenth of a degree, and it lands on the same frame.
  - The three space-folder cars are optimised copies (18.2 MB → 3.8 MB; originals in
    `models/space/source`), made like the others.

- **Offline desert** (Chrome Dino): the offline game in greys only, drawn in code (`src/render/dino`).
  - Palette: one shared monochrome theme (`theme.ts`); every material takes its grey from it, so day
    and night are a repaint of the same materials, not new ones. Pale sand, ink-grey trims, ink cacti
    and hatched ceilings. Every 7000 m of travel (about 7000 pts) the world fades over 350 m to a
    dark palette with stars and back again, as in Chrome's game: day, night, day, and so on.
  - Scenery: the roadside at the car's speed (cacti, boulders, pebbles, graveyards), giant cacti and
    pterodactyls flapping between two wing positions, wide pixel clouds and far dune ridges.
  - Tombstones carry real epitaphs: Yahoo!, AltaVista and Ask Jeeves, and Google's own shut-down
    products (Reader, Google+, Inbox, Stadia, Wave, Glass, Picasa, Orkut, Allo, Hangouts, Buzz, iGoogle,
    Talk, Podcasts). Giant monuments to what Google built (Maps pin, Android, Chrome, Waymo, Gmail,
    Search, Earth, Pixel) drift past at 12% of the car's speed, every kind once before any repeats.
  - Menu: the turntable becomes a sand disc with a small cactus. The HUD sits on a dark scrim here,
    since the pale day sky would swallow its light text.

Rendering stays free of shader-compile freezes, which in a world with many materials last seconds:

- The scene's light count never changes: fuel cells share a fixed pool of two lights that follows
  the nearest cells, instead of carrying one light each (a changing light count recompiles every lit
  material).
- Textures of models that appear later (the orbit visitors) are uploaded to the GPU as soon as
  each model downloads; uploading them on first sight cost up to half a second.
- Shaders are compiled in the background before they are needed, including track pieces, hazards
  and fuel cells that only exist once the course streams in, hidden effects such as the launch
  plume, vehicle and prop models as they finish downloading, and the bloom passes. They are compiled
  for the buffer the frame is really drawn into (with bloom, the composer's linear buffer, not the
  screen), or the programs would not match.
- The game renders at no more than 1.5× device pixels.

Colour: every world (and the menu) uses Khronos PBR Neutral tone mapping, which keeps base colours
true where ACES shifted hues (pale suns, olive skies). Worlds with bloom draw through a multisampled
buffer so edges stay anti-aliased. The light that travels with the car sits ahead of and above it,
lighting the road, rather than just above the roof, where mirror-smooth glass turned it into a flare.

Scenery is visual only and never collides. Tiles are generated from the run seed and tile index (the
same seed gives the same world), built at most one per frame at the far edge, and dropped behind.
Textures are 16×16 pixel art generated in `src/render/voxel/textures.ts`. Islands are meshed with
face culling and baked corner shading (`mesher.ts`).

## Flying sections

After about 6000 m of driving (6000 ± 500) the road ends and the car flies for about 2000 m: no
floor, walls or ceiling, only gates, pillars, slots and crates to fly around. Then the floor returns,
and about 6000 m of driving later it happens again. Distance equals points but for flip bonuses.
Every world uses it, with its own look for the obstacles.

- Controls are the same. Space lifts, ← → bank the car (A / D too, and the touch pad), the fuel gauge
  shows ∞ and the heat gauge idles. The bank is capped at 60°, the car levels out when the key is
  released, and it cannot flip. Gravity is 60% and lift 30 m/s², tuned in `CONFIG.flight`.
- A banner warns 500 m ahead, calls the take-off ("hold Space, the road ends in N m"), and in the last 420 m calls the landing.
- Take-off: a 90 m launch strip, then the floor ends. Landing: a 200 m strip at the end, joined to the
  next ordinary chunk. Missing it by flying out of the play volume (±20 m wide, −6 to 46 m high) ends the run.
- Course: `src/game/course/flight.ts`. A seeded route weaves through the section (sideways and
  up and down, rising from the launch strip and settling back onto the landing strip). Every ring wall
  has its opening on the route, walls overshoot the play volume so none can be flown around, and the
  other obstacles keep clear of it. Flight chunks are 250 m long and need no physical validation: the
  route's curvature stays within half of what banking can follow at boosted top speed, and the tests
  fly whole sections with an autopilot that has only the player's three inputs (`tests/flight-helpers.ts`),
  also with weaker gains as a stand-in for a person.
- Try it without driving 6000 m: `/?seed=42&flyat=300` starts the first section at about 300 m.

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
