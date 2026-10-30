// SVGcinema — help/topics/start: Getting started (scenes and tour steps; the words are in help/content.json)
import { S } from '../../core/state';
import { select, setTool } from '../../core/history';
import { click, drag, press } from '../ghost';
import {
  type Scene,
  type TourStep,
  allLayers,
  keyAt,
  lock,
  offCentre,
  playStep,
  playheadStep,
  q,
  screenOf,
  svg640,
  trackBits,
} from '../kit';

/** the ball the person drew (the last ellipse) */
const ball = () =>
  allLayers()
    .filter(l => l.type === 'ellipse')
    .pop() || null;

export const scenes: Record<string, Scene> = {
  // Your first animation: an empty stage to draw a ball on
  'first-animation': {
    name: 'Practice: your first animation',
    svg: svg640(`<path id="Ground" d="M0 318c120-14 230-16 340-8s210 12 300 0v90H0z" fill="#1f2b5c"/>`),
    setup() {
      lock('Sky', 'Ground');
    },
  },
};

export const tours: Record<string, TourStep[]> = {
  'first-animation': [
    {
      target: () => q('#tools [data-group="shapes"]'),
      enter: () => S.tool === 'ellipse' && setTool('select'),
      done: () => S.tool === 'ellipse',
      show: () => press('O', 'o', 'KeyO'),
    },
    {
      target: () => q('#wrap'),
      enter: c => (c.n = allLayers().filter(l => l.type === 'ellipse').length),
      done: c => allLayers().filter(l => l.type === 'ellipse').length > c.n,
      show: () => drag(screenOf(150, 228), screenOf(214, 292), { shift: true }),
    },
    {
      target: () => q('#insp .kb[data-kb="pos"]'),
      enter: () => {
        const b = ball();
        if (b && S.sel !== b.id) select(b.id);
      },
      done: () => !!ball()?.t.pos,
      show: () => click(q('#insp .kb[data-kb="pos"]')),
      clip: () => trackBits(ball(), 'pos'),
    },
    playheadStep(),
    {
      target: () => q('#wrap'),
      done: () => keyAt(ball(), 'pos', S.time),
      show: async () => {
        await press('V', 'v', 'KeyV');
        const b = ball();
        if (!b) return;
        const a = offCentre(b),
          k = screenOf(330, 0).x - screenOf(0, 0).x;
        await drag(a, { x: a.x + k, y: a.y }, { ms: 900 });
      },
    },
    playStep(),
  ],
};
