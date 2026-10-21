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
- Suction consumes fuel and heats much faster on floors; overheat has recovery hysteresis.
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

## 9. Harder opening, surface obstacles, held suction and main menu — IN PROGRESS

- [ ] Increase opening difficulty by 50% while preserving validated maneuver limits.
- [ ] Place obstacles on floors, ceilings and both walls inside the world-generation validator.
- [ ] Replace suction toggle with hold E throughout controls, physics and recorded route validation.
- [ ] Add a main menu with a spinning 3D roadster; Space or clicking the car starts the run.
- [ ] Verify these features together before advancing to release checks (≥95% confidence gate).

## 10. Menu and obstacle update verification — NOT STARTED

- [ ] Run regression tests, production build and independent review.
- [ ] Verify the menu, hold/release suction and generated hazards in the browser.
- [ ] Update documentation and refresh the playable preview.

## Evidence / issues

- Baseline environment had no `npm` on PATH; resolved with the verified local Node 22 distribution.
- V1 sets velocities directly, lets arrows steer on contact, includes brake/reverse and artificial roll pop.
- V1 generation uses hand-tuned gap/fuel tables plus a test autopilot. These are not a sufficient V2
  constructive per-chunk validation guarantee, especially once roll, proximity and heat change.
