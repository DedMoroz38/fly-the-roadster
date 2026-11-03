import * as THREE from 'three';

export interface ParallaxTile { object: THREE.Object3D; animate?(time: number): void; dispose(): void }

export interface ParallaxOptions {
  /** Scenery advances at this fraction of the camera's forward speed (0.1 = ten times slower). */
  speed: number;
  /** Scenery-coordinate length of one tile. */
  tileLength: number;
  /** Scenery-coordinate distance kept ahead of and behind the camera. */
  ahead: number;
  behind: number;
  build(index: number): ParallaxTile;
}

/** Scenery coordinate of the camera: it moves at `speed` times the camera's logical distance. */
export const sceneryPosition = (cameraDistance: number, speed: number) => cameraDistance * speed;

/**
 * World Z of a tile's origin. Tile content sits at local z = −s (forward is −Z), so an object at
 * scenery coordinate S ends up (S − scenery position) metres ahead of the camera. Everything is
 * computed relative to the camera, so large distances never reach Float32 positions.
 */
export const tileWorldZ = (cameraZ: number, index: number, tileLength: number, scenery: number) => cameraZ - (index * tileLength - scenery);

/** Streams seeded tiles around the camera; each tile is built once and dropped when far behind. */
export class ParallaxLayer {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<number, ParallaxTile>();

  constructor(private readonly options: ParallaxOptions) {}

  update(cameraZ: number, cameraDistance: number, time: number) {
    const { speed, tileLength, ahead, behind, build } = this.options;
    const scenery = sceneryPosition(cameraDistance, speed);
    const first = Math.floor((scenery - behind) / tileLength), last = Math.floor((scenery + ahead) / tileLength);
    for (const [index, tile] of this.tiles) {
      if (index >= first && index <= last) continue;
      this.group.remove(tile.object);
      tile.dispose();
      this.tiles.delete(index);
    }
    // Missing tiles in the nearer part of the view (on the first frame, or after a restart) are
    // built at once. Tiles entering at the far edge are spread over frames, one per update, so
    // ordinary travel never stalls a frame and never leaves a visible hole.
    let budget = 1;
    for (let index = first; index <= last; index++) {
      let tile = this.tiles.get(index);
      if (!tile) {
        const far = index * tileLength - scenery > ahead * 0.6;
        if (far && budget <= 0) continue;
        if (far) budget--;
        tile = build(index);
        this.tiles.set(index, tile);
        this.group.add(tile.object);
      }
      tile.object.position.z = tileWorldZ(cameraZ, index, tileLength, scenery);
      tile.animate?.(time);
    }
  }

  get tileCount() { return this.tiles.size; }

  dispose() {
    for (const tile of this.tiles.values()) tile.dispose();
    this.tiles.clear();
    this.group.clear();
  }
}
