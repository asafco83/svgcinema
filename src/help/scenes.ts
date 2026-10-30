// SVGcinema — help/scenes
// The practice scenes of the guided tours: each tutorial opens its own small scene with only what that
// tutorial needs (never the sample scene, never the user's project). A scene is plain SVG, opened the way
// File › Open opens one (its ids become the layer names), then `setup` adds what plain SVG can't say
// (locks, tracks, the animation's length and direction).
import type { Layer } from '../model/types';
import { doc } from '../core/state';

/** Every layer of the document (the list is flat: groups are the layers' parents). */
export const allLayers = (): Layer[] => doc.layers;
export const byName = (n: string) => allLayers().find(l => l.name === n) || null;
const lock = (...names: string[]) =>
  names.forEach(n => {
    const l = byName(n);
    if (l) l.lock = true;
  });

const SKY = `<defs><linearGradient id="skyg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3a78"/><stop offset="1" stop-color="#e98a6d"/></linearGradient></defs>
<rect id="Sky" width="640" height="400" fill="url(#skyg)"/>`;

export interface Scene {
  /** the project's name in the top bar */
  name: string;
  svg: string;
  setup?: () => void;
}

export const SCENES: Record<string, Scene> = {
  // Your first animation: an empty stage to draw a ball on
  'first-animation': {
    name: 'Practice: your first animation',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">${SKY}
<path id="Ground" d="M0 318c120-14 230-16 340-8s210 12 300 0v90H0z" fill="#1f2b5c"/>
</svg>`,
    setup() {
      lock('Sky', 'Ground');
      doc.dur = 2;
      doc.dir = 'alternate';
    },
  },
  // Keyframes and tracks: a sun with a face (a rotation reads), over hills
  keyframes: {
    name: 'Practice: keyframes and tracks',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">${SKY}
<g id="Sun">
<path id="Rays" d="M320 92l14 52 47-26-26 47 52 14-52 14 26 47-47-26-14 52-14-52-47 26 26-47-52-14 52-14-26-47 47 26z" fill="#ffd36e"/>
<circle id="Disc" cx="320" cy="180" r="50" fill="#ffb02e"/>
<g id="Face" fill="#7a3e12"><circle id="Left eye" cx="303" cy="170" r="5.5"/><circle id="Right eye" cx="337" cy="170" r="5.5"/><path id="Smile" d="M300 192q20 18 40 0" fill="none" stroke="#7a3e12" stroke-width="5" stroke-linecap="round"/></g>
</g>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>
</svg>`,
    setup() {
      lock('Sky', 'Hills');
      doc.dur = 2;
      doc.dir = 'alternate';
    },
  },
  // Easing: a ball that drops at one even speed (Linear), ready to be given a bounce
  easing: {
    name: 'Practice: easing',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">${SKY}
<rect id="Floor" y="320" width="640" height="80" fill="#1f2b5c"/>
<circle id="Ball" cx="320" cy="70" r="30" fill="#ffb02e"/>
</svg>`,
    setup() {
      lock('Sky', 'Floor');
      const b = byName('Ball');
      if (b) {
        const [x, y] = (b.b.pos as number[]) || [0, 0];
        b.t.pos = [
          [0, [x, y], 'linear'],
          [1.4, [x, y + 220], 'linear'],
        ];
      }
      doc.dur = 2;
      doc.dir = 'normal';
    },
  },
};
