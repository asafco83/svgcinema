// SVGcinema — help/topics/timing: Timing (scenes and tour steps; the words are in help/content.json)
import { S } from '../../core/state';
import { setTime } from '../../core/history';
import { isEasePopOpen } from '../../ui/ease-pop';
import { click } from '../ghost';
import { type Scene, type TourStep, byName, lock, pause, playStep, q, svg640 } from '../kit';

export const scenes: Record<string, Scene> = {
  // Easing: a ball that drops at one even speed (Linear), ready to be given a bounce
  easing: {
    name: 'Practice: easing',
    svg: svg640(`<rect id="Floor" y="320" width="640" height="80" fill="#1f2b5c"/>
<circle id="Ball" cx="320" cy="70" r="30" fill="#ffb02e"/>`),
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
    },
  },
};

const ballSeg = () => {
  const b = byName('Ball');
  return b ? q(`.tl .seg[data-lid="${b.id}"][data-prop="pos"]`) : null;
};

export const tours: Record<string, TourStep[]> = {
  easing: [
    {
      ...playStep(),
      enter: () => {
        pause();
        setTime(0);
      },
    },
    {
      target: ballSeg,
      done: () => S.keys.size > 0,
      show: () => click(ballSeg(), 0.5, 0.5),
    },
    {
      target: () => q('#tEase'),
      done: () => isEasePopOpen(),
      show: () => click(q('#tEase')),
    },
    {
      target: () => q('#ezPop'),
      done: () => {
        const b = byName('Ball');
        return !!(b && b.t.pos && b.t.pos[0][2] === 'outBounce');
      },
      show: async () => {
        await click(q('#ezDir [data-v="out"]'));
        await click(q(`#ezGrid [data-ez='"outBounce"']`));
      },
    },
    playStep(),
  ],
};
