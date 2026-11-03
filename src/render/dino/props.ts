import * as THREE from 'three';
import { PixelBuilder } from './pixels';

/** Products Google shut down, and search engines it outlived, as epitaphs: name, then years. */
export const GRAVES: readonly (readonly [string, string])[] = [
  ['YAHOO!', '1994–2017'],
  ['ALTAVISTA', '1995–2013'],
  ['ASK JEEVES', '1996–2006'],
  ['GOOGLE READER', '2005–2013'],
  ['GOOGLE+', '2011–2019'],
  ['INBOX', '2014–2019'],
  ['STADIA', '2019–2023'],
  ['GOOGLE WAVE', '2009–2012'],
  ['GOOGLE GLASS', '2013–2015'],
  ['PICASA', '2002–2016'],
  ['ORKUT', '2004–2014'],
  ['ALLO', '2016–2019'],
  ['HANGOUTS', '2013–2022'],
  ['GOOGLE BUZZ', '2010–2011'],
  ['IGOOGLE', '2005–2013'],
  ['GOOGLE TALK', '2005–2017'],
  ['PODCASTS', '2016–2024'],
];

/** The big things Google made, as monuments. Each is drawn about 10 m tall at scale 1. */
export const MONUMENTS = ['maps', 'android', 'chrome', 'waymo', 'gmail', 'search', 'earth', 'pixel'] as const;
export type MonumentKind = typeof MONUMENTS[number];
export const MONUMENT_NAMES: Record<MonumentKind, string> = {
  maps: 'GOOGLE MAPS', android: 'ANDROID', chrome: 'CHROME', waymo: 'WAYMO', gmail: 'GMAIL', search: 'SEARCH', earth: 'GOOGLE EARTH', pixel: 'PIXEL',
};

/** A dino-game cactus: a pillar with up to two bent arms. Height in metres. */
export function cactus(b: PixelBuilder, height: number, arms: 0 | 1 | 2 = 2, tone: 'ink' | 'dark' = 'ink') {
  const w = Math.max(0.5, height * 0.17);
  b.box(tone, 0, height / 2, 0, w, height, w);
  // A pale rib up the front gives the flat pillar some depth.
  b.box('paper', 0, height * 0.52, w / 2 + 0.01, w * 0.14, height * 0.7, 0.02);
  const arm = (side: number, rise: number, reach: number) => {
    const y = height * rise, aw = w * 0.7;
    b.box(tone, side * (w / 2 + reach / 2), y, 0, reach, aw, aw);
    b.box(tone, side * (w / 2 + reach - aw / 2), y + height * 0.14, 0, aw, height * 0.3, aw);
  };
  if (arms >= 1) arm(-1, 0.42, w * 1.1);
  if (arms >= 2) arm(1, 0.58, w * 1.1);
}

/** A tombstone with an epitaph, a mound at its foot and a dark outline so it reads on pale sand. */
export function tombstone(b: PixelBuilder, name: string, years: string, cross = false) {
  b.box('mist', 0, 0.12, 0.35, 3.2, 0.24, 1.6); // mound
  if (cross) {
    b.box('ink', 0, 1.6, 0, 0.5, 3.2, 0.4);
    b.box('ink', 0, 2.3, 0, 1.9, 0.5, 0.4);
    b.label(['R.I.P', name, years], 0, 0.9, 0.22, 1.7, 1.7);
    return;
  }
  b.box('ink', 0, 1.35, -0.06, 2.6, 2.4, 0.4); // outline
  b.box('ink', 0, 2.75, -0.06, 2.0, 0.6, 0.4);
  b.box('ink', 0, 3.15, -0.06, 1.2, 0.3, 0.4);
  b.box('light', 0, 1.35, 0.1, 2.3, 2.2, 0.3); // face
  b.box('light', 0, 2.75, 0.1, 1.7, 0.5, 0.3);
  b.box('light', 0, 3.1, 0.1, 0.9, 0.2, 0.3);
  b.label(['R.I.P', name, years], 0, 1.65, 0.26, 2.1, 2.4);
}

/** A pterodactyl as in the offline game, in one of its two wing positions. */
export function pterodactyl(b: PixelBuilder, wingsUp: boolean) {
  b.box('ink', 0, 0, 0, 0.8, 0.8, 2.6);
  b.box('ink', 0, 0.1, -1.9, 0.5, 0.5, 1.3); // beak
  b.box('ink', 0, 0.2, 1.5, 0.35, 0.35, 0.9); // tail
  b.box('dark', 0, 0.45, -1.0, 0.7, 0.4, 0.6); // crest
  const y = wingsUp ? 1.0 : -0.9;
  b.box('ink', -1.9, y * 0.5, 0.1, 3.0, 0.25, 1.4);
  b.box('ink', 1.9, y * 0.5, 0.1, 3.0, 0.25, 1.4);
  b.box('dark', -3.2, y, 0.1, 1.1, 0.25, 0.9);
  b.box('dark', 3.2, y, 0.1, 1.1, 0.25, 0.9);
}

/** A flat, wide cloud of stacked boxes. */
export function cloud(b: PixelBuilder, width: number) {
  b.box('mist', 0, 0, 0, width, 1.2, 2.5);
  b.box('mist', -width * 0.15, 0.9, 0, width * 0.5, 1.0, 2.5);
  b.box('mist', width * 0.2, 0.7, 0, width * 0.3, 0.8, 2.5);
}

/** Rounded boulder of two boxes. */
export function rock(b: PixelBuilder, size: number) {
  b.box('mid', 0, size * 0.3, 0, size * 1.6, size * 0.6, size);
  b.box('mid', size * 0.1, size * 0.7, 0, size, size * 0.4, size * 0.7);
}

function ring(r: number, tube: number, arc = Math.PI * 2) {
  return new THREE.TorusGeometry(r, tube, 6, 48, arc);
}

/** One monument, about 10 m tall, standing on y = 0 and facing +Z. */
export function monument(b: PixelBuilder, kind: MonumentKind) {
  b.box('dark', 0, 0.2, 0, 7, 0.4, 5); // plinth
  switch (kind) {
    case 'maps': {
      // A pin: a ball on a stepped point, with a hole.
      for (let i = 0; i < 5; i++) b.box('ink', 0, 1.3 + i * 0.9, 0, 4.2 - i * 0.8, 0.9, 2);
      b.solid('ink', new THREE.SphereGeometry(2.4, 14, 10).translate(0, 7.2, 0));
      b.solid('paper', new THREE.CylinderGeometry(1, 1, 2.2, 16).rotateX(Math.PI / 2).translate(0, 7.2, 0));
      break;
    }
    case 'android': {
      b.solid('ink', new THREE.SphereGeometry(2.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 6.8, 0)); // head
      b.box('paper', -0.9, 7.6, 2.0, 0.4, 0.4, 0.3); b.box('paper', 0.9, 7.6, 2.0, 0.4, 0.4, 0.3);
      b.box('ink', -1.1, 9.4, 0, 0.18, 1.3, 0.18); b.box('ink', 1.1, 9.4, 0, 0.18, 1.3, 0.18);
      b.box('ink', 0, 4.4, 0, 4.4, 3.8, 3.6); // body
      b.box('ink', -3.0, 4.6, 0, 1.2, 3.2, 1.2); b.box('ink', 3.0, 4.6, 0, 1.2, 3.2, 1.2); // arms
      b.box('ink', -1.2, 1.4, 0, 1.2, 2.6, 1.2); b.box('ink', 1.2, 1.4, 0, 1.2, 2.6, 1.2); // legs
      break;
    }
    case 'chrome': {
      // Three coloured arcs, here three greys, round a ball.
      const arcs: [Parameters<PixelBuilder['solid']>[0], number][] = [['ink', 0], ['dark', 1], ['mid', 2]];
      for (const [tone, i] of arcs) b.solid(tone, ring(3.6, 1.1, (Math.PI * 2) / 3).rotateZ((i * Math.PI * 2) / 3 + 0.3).translate(0, 5.5, 0));
      b.solid('paper', new THREE.SphereGeometry(2.4, 14, 10).scale(1, 1, 0.5).translate(0, 5.5, 0));
      b.solid('ink', new THREE.SphereGeometry(1.9, 14, 10).scale(1, 1, 0.6).translate(0, 5.5, 0.1));
      break;
    }
    case 'waymo': {
      b.box('ink', 0, 1.8, 0, 3.6, 1.6, 7); // body
      b.box('dark', 0, 3.1, 0.3, 3.0, 1.2, 3.6); // cabin
      b.box('paper', 0, 3.2, 2.15, 2.4, 0.8, 0.1); // windscreen
      b.solid('ink', new THREE.CylinderGeometry(0.8, 0.8, 0.9, 14).translate(0, 4.2, 0.3)); // lidar
      b.solid('paper', new THREE.CylinderGeometry(0.82, 0.82, 0.12, 14).translate(0, 4.2, 0.3));
      for (const [x, z] of [[-1.9, 2.3], [1.9, 2.3], [-1.9, -2.3], [1.9, -2.3]]) b.solid('dark', new THREE.CylinderGeometry(0.85, 0.85, 0.6, 14).rotateZ(Math.PI / 2).translate(x, 1.0, z));
      break;
    }
    case 'gmail': {
      b.box('ink', 0, 5.2, 0, 8, 5.4, 0.8); // envelope
      b.box('paper', 0, 5.2, 0.25, 7.4, 4.8, 0.6);
      const flap = (side: number) => b.solid('ink', new THREE.BoxGeometry(5.4, 0.45, 0.4).rotateZ(side * 0.62).translate(side * -1.95, 6.6, 0.6));
      flap(1); flap(-1);
      b.box('ink', -3.7, 5.2, 0.6, 0.5, 4.6, 0.4); b.box('ink', 3.7, 5.2, 0.6, 0.5, 4.6, 0.4);
      break;
    }
    case 'search': {
      b.solid('ink', ring(2.9, 0.65).translate(0, 6.4, 0));
      b.solid('mist', new THREE.CircleGeometry(2.8, 24).translate(0, 6.4, 0));
      b.solid('ink', new THREE.BoxGeometry(1.1, 4.6, 1.1).rotateZ(-0.78).translate(-3.2, 2.9, 0));
      break;
    }
    case 'earth': {
      b.solid('mid', new THREE.SphereGeometry(4.2, 16, 12).translate(0, 5.2, 0));
      b.solid('ink', ring(4.35, 0.12).translate(0, 5.2, 0));
      b.solid('ink', ring(4.35, 0.12).rotateY(Math.PI / 2).translate(0, 5.2, 0));
      b.solid('ink', ring(4.35, 0.12).rotateX(Math.PI / 2).translate(0, 5.2, 0));
      b.box('dark', -1.4, 6.0, 3.6, 1.8, 1.1, 0.9); b.box('dark', 1.6, 3.9, 3.5, 1.4, 1.5, 0.9); // continents
      break;
    }
    case 'pixel': {
      b.box('ink', 0, 5.2, 0, 4.2, 9.2, 0.7); // phone
      b.box('paper', 0, 5.0, 0.34, 3.6, 8.2, 0.1); // screen
      b.box('ink', 0, 8.2, -0.5, 4.2, 0.9, 0.5); // camera bar
      b.solid('dark', new THREE.CylinderGeometry(0.28, 0.28, 0.3, 12).rotateX(Math.PI / 2).translate(-0.8, 8.2, -0.9));
      b.solid('dark', new THREE.CylinderGeometry(0.28, 0.28, 0.3, 12).rotateX(Math.PI / 2).translate(0.2, 8.2, -0.9));
      break;
    }
  }
  b.label([MONUMENT_NAMES[kind]], 0, 0.5, 2.55, 6.4, 1.6);
}
