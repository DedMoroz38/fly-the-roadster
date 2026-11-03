import * as THREE from 'three';

/** Chrome's offline game turns dark every 700 points; here the same swap comes every 7000 m. */
export const DINO_DAY = { period: 7000, fade: 350 } as const;

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/**
 * How dark the world is at a logical distance: 0 is day, 1 is night. Day lasts the first 7000 m,
 * then it alternates, each swap fading over `fade` metres from the boundary onward.
 */
export function nightAt(distance: number): number {
  if (distance <= 0) return 0;
  const k = Math.floor(distance / DINO_DAY.period);
  if (k === 0) return 0;
  const into = distance - k * DINO_DAY.period;
  const to = k % 2, from = 1 - to;
  return from + (to - from) * smooth(into / DINO_DAY.fade);
}

/** Grey levels, from the background (0) to the ink (1). */
export const TONES = { paper: 0, light: 0.1, mist: 0.22, mid: 0.45, dark: 0.72, ink: 1 } as const;
export type Tone = keyof typeof TONES;

const DAY = { paper: new THREE.Color(0xf7f7f7), ink: new THREE.Color(0x535353) };
const NIGHT = { paper: new THREE.Color(0x14151a), ink: new THREE.Color(0xdcdcdc) };

/**
 * One shared monochrome palette. Every dino-world material takes its colour from a tone here, and
 * `setNight` rewrites them all in place, so the swap between day and night needs no new materials.
 */
export class DinoTheme {
  readonly paper = new THREE.Color();
  readonly ink = new THREE.Color();
  night = 0;
  private readonly tones = new Map<number, THREE.Color>();

  constructor() { this.setNight(0); }

  /** The shared colour for a grey level; every caller of the same tone gets the same object. */
  tone(tone: Tone | number): THREE.Color {
    const k = typeof tone === 'number' ? tone : TONES[tone];
    let color = this.tones.get(k);
    if (!color) { color = new THREE.Color(); this.tones.set(k, color); this.paint(color, k); }
    return color;
  }

  setNight(night: number) {
    this.night = night;
    this.paper.copy(DAY.paper).lerp(NIGHT.paper, night);
    this.ink.copy(DAY.ink).lerp(NIGHT.ink, night);
    for (const [k, color] of this.tones) this.paint(color, k);
  }

  private paint(color: THREE.Color, k: number) { color.copy(this.paper).lerp(this.ink, k); }
}

/** The theme of the world being drawn; one renderer shows one dino world at a time. */
export const DINO_THEME = new DinoTheme();
