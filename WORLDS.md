# Worlds per vehicle

> Status: Steve's voxel sky-island world is built (see README → Worlds). Other worlds are ideas.

Idea: each vehicle gets its own world. The track, hazards and sky are restyled, and the course
itself (layout, physics, validation) stays the same for everyone. Steve's world should look like a
Minecraft-style sky world: floating voxel islands, waterfalls, lanterns, a portal-arch track and
mobs at the edges.

## Verdict

Medium effort: **about 4–6 days for the first world** (Steve), then **1–2 days per extra world**.
All the work is in the renderer, and most of it is art rather than code. Generation, physics and
validation don't change, because scenery is visual only and never collides.

## The world as the track sees it

What exists now: a flat background colour, fog from 70 to 400 m, one star field that follows the
camera, and fixed colours for surfaces, hazards and pickups.

| Track element | Steve's world |
| --- | --- |
| Floor, walls, ceiling slabs | Stone-brick and smooth-stone block tiles, pixel textures with nearest-neighbour filtering |
| Red box hazards | Obsidian or TNT-style blocks |
| Gates (the wall with one opening) | Obsidian portal frames with glowing corner blocks, like the arches in the image |
| Full-width barriers | Low fences or slab walls |
| Fuel cells | Glowing emerald or experience-orb blocks |
| Sky | Gradient dome, stars, a square sun at the horizon, fog tinted to match |
| Glow | One bloom pass so lanterns and portals glow (costs some GPU) |

## Scenery that moves 10× slower and regenerates

- **How it moves:** a scenery layer whose position follows the camera at 90%, so it drifts past at
  10% of the car's speed. This is classic parallax: it reads as far away without real distances,
  and the origin rebase every 256 m just shifts it along with everything else.
- **How it regenerates:** split the layer into tiles keyed by `0.1 × distance`, and build each tile
  from the run seed plus the tile index, so the same seed gives the same scenery. Keep a small ring
  of tiles: add one ahead, drop one behind. Because it moves slowly, a new tile is needed only every
  few seconds, so generation is cheap.
- **What a tile contains:** a few floating islands built from a seeded noise heightmap (grass, dirt
  and stone layers, trees, hanging vines), drawn as one instanced cube mesh per block type so it
  stays at a handful of draw calls. Waterfalls are scrolling textured strips, and lanterns are
  emissive cubes.
- **Mobs:** creepers, skeletons and a ghast built from boxes in code (no models needed), standing on
  islands or bobbing in the air.
- **Rolling:** when the car rolls onto a wall or ceiling the camera rolls, so the whole world turns
  around the track. That's fine and adds to the effect.

Estimate for Steve's world:

| Part | Effort |
| --- | --- |
| Theme system (per-vehicle colours, materials, sky, fog) | 0.5 day |
| Pixel block textures and a textured track | 1 day |
| Parallax island tiles with seeded regeneration | 1.5 days |
| Sky, sun, bloom | 0.5 day |
| Props: mobs, waterfalls, lanterns | 1 day |
| Tuning for frame rate and hazard readability | 0.5–1 day |

## A world for every vehicle

| Vehicle | World |
| --- | --- |
| Fast Charger | Today's neon synthwave grid (default) |
| Tesla Roadster | Earth orbit: the planet below, asteroids drifting past, a starfield |
| Cybertruck | Mars: red canyons, mesas, dust haze, a rover base in the distance |
| DeLorean | Neon 1980s night city with a clock tower, and a time-vortex tunnel in flight gaps |
| Chrome Dino | The offline-game desert: grey monochrome, cacti, pterodactyls, pixel clouds |
| Steve in a Boat | Voxel sky islands, as above |

Once the theme system and parallax tiles exist, each new world is a colour palette, a tile
generator and a few props.

## Risks

- **Readability:** hazards must stay high-contrast against busy scenery. Keep a darker band of sky
  behind the track, and make obstacles glow or outline them.
- **Performance:** keep every scenery layer instanced and limit bloom on low-power devices. Target:
  scenery adds under 50 draw calls.
- **IP:** use original pixel textures, not Mojang's, and keep "Minecraft", "Tesla" and "Back to the
  Future" out of public names and branding. The Sketchfab models stay credited (CC BY 4.0).
- **Polish:** the reference image is an offline render. Real-time will be simpler (no ray-traced
  light or soft shadows) but can get close in mood with fog, bloom and a warm sun.
