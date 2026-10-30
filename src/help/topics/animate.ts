// SVGcinema — help/topics/animate: Animate (scenes and tour steps; the words are in help/content.json)
import { S, selLayer } from '../../core/state';
import { select } from '../../core/history';
import { click, type } from '../ghost';
import {
  type Scene,
  type TourStep,
  byName,
  keyAt,
  lock,
  lpRow,
  playStep,
  playheadStep,
  q,
  shapeEl,
  svg640,
  trackBits,
} from '../kit';

export const scenes: Record<string, Scene> = {
  // Keyframes and tracks: a sun with a face (a rotation reads), over hills
  keyframes: {
    name: 'Practice: keyframes and tracks',
    svg: svg640(`<g id="Sun">
<path id="Rays" d="M320 92l14 52 47-26-26 47 52 14-52 14 26 47-47-26-14 52-14-52-47 26 26-47-52-14 52-14-26-47 47 26z" fill="#ffd36e"/>
<circle id="Disc" cx="320" cy="180" r="50" fill="#ffb02e"/>
<g id="Face" fill="#7a3e12"><circle id="Left eye" cx="303" cy="170" r="5.5"/><circle id="Right eye" cx="337" cy="170" r="5.5"/><path id="Smile" d="M300 192q20 18 40 0" fill="none" stroke="#7a3e12" stroke-width="5" stroke-linecap="round"/></g>
</g>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
};

export const tours: Record<string, TourStep[]> = {
  keyframes: [
    {
      target: () => lpRow('Sun'),
      enter: () => select(null),
      done: () => selLayer()?.name === 'Sun',
      show: () => click(lpRow('Sun'), 0.3, 0.5),
    },
    {
      target: () => q('#insp .kb[data-kb="rot"]'),
      enter: () => {
        const s = byName('Sun');
        if (s && S.sel !== s.id) select(s.id);
      },
      done: () => !!byName('Sun')?.t.rot,
      show: () => click(q('#insp .kb[data-kb="rot"]')),
      clip: () => trackBits(byName('Sun'), 'rot'),
    },
    playheadStep(),
    {
      target: () => q('#rot-deg')?.closest('.row') || null,
      done: () => keyAt(byName('Sun'), 'rot', S.time),
      show: () => type(q('#rot-deg') as HTMLInputElement, '90'),
      clip: () => [shapeEl(byName('Sun'))],
    },
    playStep(),
  ],
};
