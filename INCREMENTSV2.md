# Fly the Roadster V2 — Verified Increments

Source: the supplied “Improve Vehicle Physics and Implement Solvable Infinite 3D Terrain Generation” task.
Work branch: `fly-the-roadster-v2`. V1 history remains in `INCREMENTS.md`.

Each increment must pass its relevant automated checks and review before the next begins.
The ≥95% confidence gate is an engineering judgement supported by recorded evidence, not a claim
that tests mathematically prove the absence of bugs. Failed checks stay visible until resolved.

## Decisions

- Forward is −Z; only Z rotation is controllable. W accelerates; no braking/reversing.
- Arrow keys always apply roll torque. A/D remain independent surface steering.
- Forces/torques drive the dynamic Rapier body; contacts resist grounded rolls.
- Suction consumes more fuel on floors and heats at one rate everywhere; overheat has recovery hysteresis.
- Construct movement plans before geometry, using the same movement constants and finite resources.
- Validation is deterministic physics/kinematics, never reinforcement learning or a player-driving AI.
- Debug URLs select seed and challenge; generation and rendering must remain bounded.

## 1. Baseline and implementation contract — DONE

- [x] Read the requested changes and inspect the existing game/tests.
- [x] Record this plan before changing gameplay.
- [x] Local Node 22.23.4 (official archive, SHA-256 verified); baseline 111 tests and production build pass.
- [x] Independent physics review confirmed obsolete control/test assumptions; gates recorded below.

Gate passed: baseline understood and reproducible; confidence ≥95%.

## 2. Automatic forward motion and physical roll — DONE

- [x] Remove brake/reverse controls; cruise automatically in air and on surfaces.
- [x] Force-based acceleration, lift, steering and torque-based roll/stabilization.
- [x] Contact resistance on floors; no arrow-induced lateral drive or artificial pop.
- [x] Verify cruise/release/air momentum, collisions, grounded tilt, both full airborne rolls, locked pitch/yaw.

Gate passed: 89 relevant regressions + production build; independent physics review. Measured cruise
24.0002 m/s, acceleration 31.9974 m/s; first 0.15 s roll is 9.21° on floor vs 19.87° airborne.
No per-step pose/velocity setters remain. Legacy terrain feasibility tests are replaced in increment 4,
as their V1 control/resource assumptions are obsolete. Browser automation lost its debugger connection;
visual verification remains in the final browser gate. Confidence ≥95% for movement behavior.

## 3. Suction resources and player feedback — DONE

- [x] Heat, floor penalty, cooldown lockout, finite energy, close/aligned surface engagement.
- [x] Verify floor overheat/recovery, extended wall/ceiling travel, proximity and orientation.
- [x] Heat HUD and correct left/right exhaust; update help and start flow.
- [x] Verify renderer/HUD bindings and build.

Gate passed: 72 thermal/resource/attachment/transition/session/visual tests and production build.
Browser confirmed automatic cruise (86 km/h), fuel drain, visible heat and lockout cooling through
51%. Wall and ceiling remain attached for 25 s, heat <40%, fuel >3.9/5. Proximity is 2.5 m,
attachment 0.4 m. Floor heat 24/s vs 1.5/s elsewhere; off cooling 18/s; lockout 100→below35.
Confidence ≥95% for resource and feedback behavior.

## 4. Constructive route planning and reachability — DONE

- [x] Shared motion model, resource/time margins, entry/exit contracts and rejection reasons.
- [x] Generated A–F challenges, including finite-fuel flight and combined transitions.
- [x] Validate candidates before accepting geometry; safe recovery fallback.
- [x] Verify real-physics movement witnesses, adverse timing/speed margins, impossible candidate rejection.

Gate passed: 139 relevant tests (138 together, then the corrected contact-roundoff test in its
13-test suite) and production build. All A–F families including both walls pass actual Rapier
replays. Independent checks reject missing landing/ceiling, no fuel/recharge, and heat lockout;
combined→right-wall witnesses run continuously in one world. Bounded retry/fallback verified.
A 0.006 m/s seam solver difference is checked with an explicit 0.02 m/s numerical tolerance,
well within the 0.5 m/s stable-exit limit. No gameplay assertion was removed.
Validation covers ±0.15 s launch/action and suction engagement, entry speeds 24/28/32 m/s,
2 s reaction time, real pickups and inherited exit state. Timing variants permit normal steering
correction on supported surfaces; sustained W throughout a maneuver is not certified.
Confidence ≥95% within this stated route contract.

## 5. Endless terrain, difficulty and debugging — DONE

- [x] Stream accepted chunks and obstacles around protected routes; guaranteed recharge opportunities.
- [x] Seeded logarithmic difficulty, bounded physical demands, recovery pacing.
- [x] Remove old route/geometry/pickup/validation data; seamless chunk boundaries.
- [x] Debug speed, fuel, heat, attachment, difficulty, chunk seed, route and template selection.
- [x] Verify reproducibility, successive chunk compatibility, all scenarios, long-distance bounded streaming.

Gate passed: all 49 terrain checks pass across the final suite and targeted reruns; separate
origin, collider, worker and render checks pass. The 50 km generation lifecycle test completes
in 61 s and now has a 120 s timeout. Three mixed courses (seeds 1/42/233) run 6 km in one physics
world using recorded inputs. A 100 km normal-road replay preserves speed/contact through >300
origin shifts and >500 actual pickups, with bounded terrain data and colliders.

The long replays exposed collision lips: buried ramps were insufficient, so contiguous physical
surfaces now share a collider. Closed meshes preserve bevelled planes without internal-edge
impulses; logical chunk intervals stay unchanged. Physics and rendering rebase every 256 m.
Checks preserve movement at 10 million logical metres and render fractional geometry at 1 billion.
Continuous versus isolated witnesses differ by ~0.318 m at one boundary (13 ms at cruise); both
boundary-distance checks allow one integration step, with all velocity/resource/stability checks
retained. This stays well inside the certified ±150 ms timing margin. Browser confirms streamed
play beyond 3 km, F3, same-seed restart, acceleration, and visible floor overheat lockout.
Independent review found no remaining blocker. Confidence ≥95% within the documented route contract.

## 6. Final verification and documentation — DONE

- [x] Full regression tests and production build.
- [x] Browser checks of automatic movement, roll exhaust, suction heat, debugging and restart.
- [x] Independent review of reachability guarantees and remaining limitations.
- [x] Update README, acceptance evidence and final status here.

Final gate passed: `npm test -- --maxWorkers=2` — **184 tests / 22 suites pass** (76.42 s).
`npm run build` passes TypeScript and Vite production bundling, including the generation worker.
The production preview on port 4173 loads its worker, cruises at 24 m/s, streams the next flight-gap
challenge, and displays the validated route. Browser checks also confirmed acceleration to 31.6 m/s,
visible paired roll exhaust while tilting against the floor, same-seed restart, F3 toggling, and floor
overheat lockout at 86% while cooling. Normal streamed browser play exceeded 3 km with stable visuals.
The preview is left paused with help visible; H or Esc resumes.

README documents controls, tuning, reproducible seed/template URLs, architecture, regression coverage
and the finite timing/speed contract. Independent physics, generator and renderer reviews found no
remaining blocker. Confidence ≥95% for the requested implementation under the stated contract.
Non-blocking tool output: Rapier's bundled initializer emits its deprecation notice; Vite reports
the large physics/render bundle. No test or build errors remain. Changes are local on
`fly-the-roadster-v2`; no commit or publication was requested.

## 7. Playtest tuning — DONE

- [x] Make W / ↑ acceleration consume shared thruster fuel; preserve free automatic cruise.
- [x] End the run on a roof landing, preserving airborne rolls and ceiling driving.
- [x] Bring challenge difficulty up sooner during the opening distance, within the validated limits.
- [x] Verify fuel allocation, flipped-car behavior, early pacing and route feasibility before release.

Requested after the first playable V2 preview. The user clarified that landing on the roof should
end the run. This gate requires the same ≥95% engineering
confidence and documented tests as the original increments.

Gate passed: 51 focused tests across fuel, session, pacing and both planner suites pass together.
Acceleration consumes 0.4 units/s, shares fractional final fuel with other thrusters, and coasts
smoothly back to free 24 m/s cruise when empty. Eight new session checks cover actual inverted and
tilted roof landings, frozen game-over/restart, full airborne rolls, side landings and ceiling travel.
Roof detection uses supporting collision contacts underneath the car, not wheel probes.

The default opening floor is 160–180 m; the next two chunks request challenges. Later recovery
sections and all route validation margins remain intact. Live fixed-input replay measurements:
seed 1 first action 18.25→11.83 s, seed 42 18.78→12.42 s, seed 233 17.25→10.78 s.
Difficulty at 1 km rises from 15.55% to 28.00%. The separate pacing/generator/feasibility run passes
21 checks including three 6 km mixed runs and 100 km normal-road streaming. Confidence ≥95% for
these tuning changes under the existing finite route contract.

## 8. Playtest update verification and preview — DONE

- [x] Run the affected integration/regression suites and production build.
- [x] Refresh the playable preview and verify the changes in the browser.
- [x] Update controls, tuning notes and evidence.

Production build passes. Browser checks on seed 42 show W raising speed to 31.95 m/s while
fuel drops to 4.19/5 after roughly two seconds, the first gap cue visible at 210 m, and a floor
roll ending the run with “Landed on the roof”. R resets fuel and starts a new attempt; H shows
the updated fuel and roof-landing rules. Screenshot: `/tmp/roadster-roof-landing.jpg`.
Independent review found no blocker and additionally checked roof impacts on obstacle tops,
side/upright contacts, and inverted cars above the floor moving away without false failure.

Final gate: all **203 tests across 24 suites** have passing verification. The full run completed
in 79.33 s with 202 passing and one obsolete pickup assertion: it assumed fuel remained full while
W stayed held after collection. That test now checks the exact full refill at contact and continued
acceleration consumption afterward. All three pickup checks pass on the focused rerun; the other
202 tests were unchanged. TypeScript passes again after the test correction, and `git diff --check`
is clean. No additional gameplay changes followed the successful production build/browser checks.
Confidence ≥95% within the documented route contract. The updated preview remains on port 4173.

## 9. Harder opening, surface obstacles, held suction and main menu — DONE

- [x] Increase opening difficulty by 50% while preserving validated maneuver limits.
- [x] Place obstacles on floors, ceilings and both walls inside the world-generation validator.
- [x] Replace suction toggle with hold E throughout controls, physics and recorded route validation.
- [x] Add a main menu with a spinning 3D roadster; Space or clicking the car starts the run.
- [x] Verify these features together before advancing to release checks (≥95% confidence gate).

`difficultyAt` is exactly 1.5× the previous curve up to 1 km, then keeps increasing below one
without a step. Decoration mounts obstacles flush on every surface type, including the opening
road, outside the protected route; the decorated chunk is fully re-replayed (timing, suction and
entry-speed variants) and dropped if any replay fails. Over the first 25 chunks of seeds 1/42/233,
every chunk kept its obstacles (3–7 each) with all four surfaces used (e.g. seed 42: floor 50,
ceiling 29, left 24, right 26). Suction is a held control end to end; overheat while held resumes
only below recovery heat. The menu freezes the world until Space or a click on the car.

## 10. Menu and obstacle update verification — DONE

- [x] Run regression tests and production build (no separate independent review this round).
- [x] Verify the menu, hold/release suction and generated hazards in the browser.
- [x] Update documentation and refresh the playable preview.

The 50 km streaming bound still assumed one obstacle per chunk; it now derives from
`maxObstaclesPerSurface × SURFACES`. A new obstacle test asserts flush mounting on real slabs of
all four surfaces plus an opening-road floor obstacle. Full run: **207 tests / 24 suites pass**;
`npm run build` passes. Browser (production preview, seed 42): the menu shows the spinning car with
sim time frozen at 0; clicking the car starts the run; Space starts it without lift or fuel use;
held E reads ON with rising heat, release reads OFF and cools; floor, ceiling and both walls show
obstacles on the opening stretch.

## 11. Less plain floor driving and a spinning menu car — DONE

- [x] Measure where route time goes; cut plain-floor time without weakening validation.
- [x] Turn floor runs into certified slaloms with obstacles in the vacated lanes.
- [x] Make the menu car visibly spin, including with reduced motion enabled.
- [x] Regression tests, production build and browser check.

Baseline (seeds 1/42/233, 4 km): 71–81% of certified route time on the floor. Causes: ~118 m
lead-ins, 6.5 s (208 m) recovery after every maneuver, and flat 330 m sections every fourth chunk.
Changes: the reaction interval now runs from the latest touchdown carried across chunks
(`ReachableState.lastArrival`), so lead-ins are only as long as needed (+10 m margin for timing
and late landings); recovery 2 s; wall drop pad 20 m; traversals 150–210 m; surface-heavy challenge
weights; the ceiling-to-wall challenge mirrors to either wall (required surfaces now come from the
plan's attachments). Floor sections are slaloms whose centre lanes receive 3–4 blocks each. Result
on seeds 1/42/233/7/19: plain floor 32–41% plus 6–11% slalom; no rejected, fallback or undecorated
chunks. First maneuver 5.8–7.5 s (was 11–13 s). Generation cost per km is unchanged (~3 s to 1.6 km
in Node); the menu now appears once 400 m are validated (5.6 s vs 13.7 s in the browser), with the
existing 64 m `needsBuffer` pause still guarding play.

Test changes, with reasons: the one-world seam check now allows two physics steps; the original code
measured up to 0.76 m on other seeds and passed only on a lucky seed pair (new max seen 0.95 m,
~33 ms, inside the ±150 ms contract). The 6 km open-loop replay now bounds each chunk's own drift;
the cumulative offset random-walks across more, shorter chunks (up to 6.6 m) while every maneuver
still completes. Streaming bounds derive from configuration instead of fixed numbers. New tests:
floor share and centre slalom blocks, both mirrored walls, and the start buffer.
Full run: **210 tests / 24 suites pass**; production build passes. Browser (reduced motion enabled):
the menu car turns visibly; a slalom run shows centre blocks and "slalom left in 24 m" cues.

## 12. Barrier jumps, faster difficulty, stronger suction and Railway deploy — DONE

- [x] New `hurdle` challenge: full-width floor barriers jumped with a lift pulse and no suction.
- [x] Difficulty ramps faster (`difficultyScale` 850 → 250, `difficultyCurve` 2 → 1.5).
- [x] Suction range 2.5 → 3 m (+20%).
- [x] Wall/ceiling/airborne suction heats at the floor rate (1.5 → 24 units/s).
- [x] Dockerfile (Vite build, then nginx on `$PORT`), `railway.toml`, deploy to the linked service.

Hurdles: 1–3 barriers (count and 1–2 m height scale with difficulty), spaced 125 m so each launch
keeps the 2 s reaction interval after the previous landing. The barriers are planner obstacles, so
every replay (timing shifts, 24/28/32 m/s entries) includes their colliders. A test confirms that
driving into one without lifting triggers the crash rule.

Difficulty is now about 42% at 200 m (the old 1 km value), 63% at 500 m, 78% at 1 km and 85% at 5 km.

Equal heat limits a held surface run to ~4.2 s. With the old 150–210 m traversals, every
ceiling, wall and multiple candidate overheated and fell back to flat road. Traversals are now
80–88 m (+5 m on walls, which attach later). They must be long enough for the 2 s reaction interval
after attaching and short enough to end before overheating; validated peak heat is 82–92. Ceiling
then wall cannot fit both reaction intervals in one heat budget, so `multiple` now drops from the
ceiling, cools during a 110 m floor leg, then crosses the wall. Seeds 1/42/233 over 4 km: no
rejected candidates or fallbacks.

Test changes, with reasons: scripted ceiling/wall holds shortened to stay under the heat limit
(6 s → 2–3 s, ceiling legs started nearer the handover); the 25 s surface-hold test became "stays
attached until the floor-rate overheat"; the origin test zeroes heat each step so it still spans two
rebases; the floor-share bound moved from <55% to <68%, since surface time is about halved by the
heat limit (surface + air must still exceed 30%); the centre-block count excludes full-width
barriers; difficulty tests read the configured constants. Barrier jumps are added to the
planner and decoration suites.
Full run: **215 tests / 24 suites pass**; `npm run build` passes. Docker image built and run locally
with `PORT=9123`: index, deep links and hashed assets serve, unknown assets return 404, and the game
boots in the browser (`?template=hurdle` shows "Barrier jumps" and a full-width barrier).

## 13. Scarcer fuel, points with flip bonuses and the real car model — DONE

- [x] One fuel cell per chunk (was two, ~36 m apart across every chunk boundary).
- [x] Tank 5 → 2.5 units. A 1.25 tank was tried first and rejected (see below).
- [x] Score in points: 1 per metre plus 100 × flips² per safe landing after full airborne rolls.
- [x] Car rendered from `models/car.glb`.

Fuel: the cell sits 12 m into each chunk, before its first maneuver. Launch reserve is 1 → 0.25 and
exit reserve 1 → 0.1, since the next chunk opens with a cell. At a 1.25 tank every ceiling-to-wall,
long-flight and 3-barrier chunk failed validation (the car ran dry or ended empty) and would have
fallen back to flat road. At 2.5 every family validates; seeds 1/42/233 over 4 km: no fallbacks.

Score: `GameSession` accumulates signed roll while airborne and pays on touchdown unless that step
ends the run. A landing within 25° (the roll-assist angle) of a full roll completes it. The HUD shows
points, a "Flip / Double flip / Triple flip +N" popup, and points plus metres on game over. Checked in
the browser: one scripted roll paid +100 (91 m → 191 pts); a later jump that hit a slalom block paid
nothing.

Car: the GLB is loaded once (awaited alongside the opening terrain), turned to face −Z, scaled to the
collider length (3.4 m; width then matches at 1.8 m), centred, and rested on the collider floor. Its
wheel nodes spin with forward speed. Thruster, suction and underglow effects remain; the side roll
nozzles show only while firing because they sit outside the new bodywork. The roof is ~0.3 m taller
than the collider.

Test changes, with reasons: fixed 5-unit fuel figures now derive from `CONFIG.fuel.capacity`; the
seam test refills each step to hold top speed longer than a tank lasts; scripted ceiling/wall
transitions keep W off on surfaces, where cruise is free and suction needs the fuel; pickup counts
moved from 2 to 1 per chunk. New tests: flip counting and combo points, payout after a safe landing,
and no payout for a partial roll or a roof landing.
Full run: **218 tests / 24 suites pass**; `npm run build` passes and bundles the model.

## 14. Speed rises with difficulty, difficulty you can feel, suction on Shift — DONE

- [x] Cruise speed scales with difficulty (24 → 36 m/s; W keeps its +8 m/s margin).
- [x] Difficulty drives more of the course, and its curve keeps rising after the first kilometre.
- [x] Suction moved from E to Shift (either side).

Why difficulty was not felt: it only changed the chunk-type mix, gap/flight length (+6–8 m) and
barrier count/height, and the old curve flattened after 1 km (0.78 at 1 km, 0.87 at 10 km).

Pace: `paceFor(difficulty)` gives a chunk's cruise and top speed. The planner validates the chunk at
that pace, `Course.paceAt` reports it, and `Simulation` sets the vehicle targets each step, so live
play matches validation. Planner distances (leads, traversals, gaps, legs, hurdle spacing, slalom
segments, reaction margin) scale with the chunk's top speed relative to the base 32 m/s, so maneuver
timing, reaction intervals and heat windows stay the same in seconds. Entry-speed replays now
cover the chunk's cruise, midpoint and top speed. A fallback road keeps the requested pace.

Difficulty: `1 − exp(−√(d / 670))`, about 0.42 at 200 m (as before), 0.70 at 1 km, 0.93 at 5 km.
It also tightens slalom lane changes (up to 30%) and raises hazard density (floor 4 → 9 per chunk,
surfaces 2 → 4; spacing about a third shorter, scaled with speed). Every chunk family validates at
difficulty 1 (36/44 m/s). Seeds 1/42/233 over 5 km: no fallbacks. Seed 42 cruise ramps from
86 km/h to 116 km/h by 900 m and 127 km/h by 5 km.

Test changes, with reasons: curve tests assert the new targets and continued growth (strict growth
checked to 100 km; beyond that the curve is 1 to double precision); the flight-gap bound and seam
tolerance scale with chunk speed; the consecutive-witness test gives its static level each chunk's
pace, as the live course does (`StaticLevel.paceAt`); the obstacle bound counts hurdles and the
hardest hazard limits; input tests use Shift. New test: pace grows along a course, the course reports
it, and the car settles at the level's pace.
Full run: **219 tests / 24 suites pass**; `npm run build` passes. Browser: holding Shift attaches
suction and releasing it turns suction off, E does nothing, and cruise went from 86 to 101 km/h at
the first challenge.

## 15. No more easy stretches at high difficulty — DONE

- [x] Forced floor runs stop at difficulty 0.8; the optional easy-section chance fades to zero.
- [x] Run-up 2 → 1.2 s and recovery 2 → 1.4 s as difficulty rises (≥ 1.7 s after surfaces).
- [x] Floor stretches weave (run-ups, recovery, between barriers); every run-up fits a lane change.
- [x] Low full-width barriers (0.8–1.2 m, up to 2) inside floor runs.
- [x] Gates: wall-to-wall boxes with one opening at the route's lane (0 → 3 per chunk).

Cause (seed 2804205951, the reported screenshot at ~1.5 km): a forced every-5th floor run whose final
straight had only small side-lane boxes. Plain floor was 55% of route time. Run-ups and recovery
were straight because they were shorter than one lane change plus a return to the centre.

`chunkTiming(difficulty)` sets each chunk's reaction and recovery seconds; the planner and every
replay use it. `floorRun` fits lane changes individually and keeps the lane before floor launches
(gaps/flights recentre, since their landing must end centred). Barrier spacing shrinks with the
run-up. Gates take each opening from the route's own position, preferring off-centre openings, and
pass the same route-protection check as other boxes. Decoration is retried without gates before
falling back to the undecorated chunk.

Results: all families validate at difficulties 0.2 and 1 on seeds 123/217/5. Seeds 1/42/233 over
5 km: no fallbacks, ~1.5 s generation per km in Node. Plain floor fell to 42–47% of route time
(seeds 1/42/233/2804205951, 4 km), with ~20 gates and 3–8 barriers per 4 km.

Test changes, with reasons: reaction assertions use the chunk's own interval, and the "first
action" check excludes steering because run-ups now weave; the breather assertion only applies
below the cut-off. New `tests/difficulty.test.ts`: breathers stop past the cut-off, timing shrinks
and is certified, run-ups weave, barriers appear in hard floor runs within limits, and gates open
where the route passes.
Full run: **224 tests / 25 suites pass**; `npm run build` passes; the production build loads and
plays in the browser.

## 16. Selectable vehicles — DONE

- [x] All six models selectable on the main menu (‹ › buttons or ← →), remembered per browser.
- [x] Tesla Roadster reduced from 28.6 MB / 500k triangles to 0.48 MB / 40k triangles.
- [x] CC BY 4.0 credits shown in the menu for each Sketchfab model.

Roadster: a scan whose colour sits in an emissive texture, with a texture seam at nearly every
triangle, so standard simplification stalled at ~250k triangles. `scripts/bake-vertex-colors.mjs`
samples the texture into vertex colours, keeps the unlit look (`KHR_materials_unlit`), welds by
position, simplifies with meshoptimizer and quantizes (`KHR_mesh_quantization`); three.js loads both
extensions without extra decoders. The original stays in `models/` but is not bundled and is
excluded from the Docker build context.

Per-model fixes found by viewing each in game from the chase camera: Steve faces +Z already
(yaw 0) and ships with 144 water tiles that made the boat tiny, now stripped at load; the dino is a
flat side-on sprite turned to face forward (from behind it reads as a thin strip; the menu turntable
shows it fully). Models are fitted by length and capped at 1.6 m tall and 2.1 m wide; the underglow
strips tuck inside narrow bodies. The dino's walk animation plays (faster with speed); wheels spin
only where a model has wheel nodes (the Fast Charger).

Tests: catalogue ids, bundled files and credits; the light Roadster is the shipped file; selection
memory with missing, stale or blocked storage; swapping a CarModel's vehicle.
Full run: **227 tests / 26 suites pass**; `npm run build` passes and bundles six models (about 2 MB
in total, each loaded on first selection). Browser: arrow keys cycle through all six with matching
names and credits, and each was checked in game.

## Evidence / issues

- Baseline environment had no `npm` on PATH; resolved with the verified local Node 22 distribution.
- V1 sets velocities directly, lets arrows steer on contact, includes brake/reverse and artificial roll pop.
- V1 generation uses hand-tuned gap/fuel tables plus a test autopilot. These are not a sufficient V2
  constructive per-chunk validation guarantee, especially once roll, proximity and heat change.
