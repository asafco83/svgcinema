// SVGcinema — help/topics/arrange: Create, part two (booleans and align, layers and groups, hyperlinks,
// snapping and guides): scenes and tour steps; the words are in help/content.json
import { S, doc } from '../../core/state';
import { select } from '../../core/history';
import { VIEW, setView } from '../../core/view';
import { boxOf } from '../../render/overlay';
import { click, drag, type } from '../ghost';
import {
  type Scene,
  type TourStep,
  byName,
  lock,
  lpRow,
  offCentre,
  q,
  screenBox,
  screenOf,
  shapeEl,
  svg640,
} from '../kit';
import { choose, dragDoc, keep, pickRow, reveal, rowOf, selected, shown } from './style';

const sel = (...names: string[]) =>
  names.every(n => {
    const l = byName(n);
    return !!l && S.selSet.has(l.id);
  });
const box = (n: string) => {
  const l = byName(n);
  return l ? boxOf(l) : null;
};
const mid = (n: string) => {
  const b = box(n);
  return b ? [b.x + b.w / 2, b.y + b.h / 2] : [NaN, NaN];
};
/** the snowman's head: called Circle until the tour renames it */
const head = () => byName('Head') || byName('Circle');
const snowGroup = () => {
  const h = head(),
    g = h && h.parent ? doc.layers.find(l => l.id === h.parent && l.type === 'group') : null;
  return g || null;
};
/** a menu of the canvas bar (snapping, grid): open it with its button, then click the item */
async function viewItem(btn: string, v: string) {
  const m = q('#viewMenu') as HTMLElement | null;
  if (!m || m.hidden || !m.querySelector(`[data-v="${v}"]`)) await click(q(btn));
  await click(q(`#viewMenu [data-v="${v}"]`));
}
const viewMenu = () => q('#viewMenu:not([hidden])');

export const scenes: Record<string, Scene> = {
  // Booleans and align: a full moon and a round bite to take out of it
  booleans: {
    name: 'Practice: booleans and align',
    svg: svg640(`<circle id="Moon" cx="250" cy="170" r="70" fill="#fff4c9"/>
<circle id="Bite" cx="295" cy="128" r="62" fill="#e98a6d"/>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
  // Layers, groups and symbols: a snowman whose head has a plain name and whose scarf is behind the body
  layers: {
    name: 'Practice: layers, groups and symbols',
    svg: svg640(`<rect id="Snow" y="320" width="640" height="80" fill="#e9eefb"/>
<rect id="Scarf" x="268" y="206" width="104" height="18" rx="9" fill="#e5484d"/>
<circle id="Body" cx="320" cy="268" r="62" fill="#fff"/>
<circle id="Circle" cx="320" cy="172" r="44" fill="#fff"/>
<path id="Hat" d="M290 136h60v-46h-60zM276 136h88v10h-88z" fill="#141a33"/>`),
    setup() {
      lock('Sky', 'Snow');
    },
  },
  // Hyperlinks: a button to link
  hyperlinks: {
    name: 'Practice: hyperlinks',
    svg: svg640(`<g id="Button">
<rect id="Shape" x="220" y="168" width="200" height="64" rx="32" fill="#ffb02e"/>
<text id="Label" x="320" y="208" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="700" fill="#1f2b5c">Shop now</text>
</g>`),
    setup() {
      lock('Sky');
    },
  },
  // Snapping, guides and rulers: a box to line up on a guide
  snapping: {
    name: 'Practice: snapping, guides and rulers',
    svg: svg640(`<rect id="Ground" y="330" width="640" height="70" fill="#1f2b5c"/>
<rect id="Box" x="120" y="96" width="84" height="84" rx="6" fill="#ffb02e"/>`),
    setup() {
      lock('Sky', 'Ground');
    },
  },
};

/** where the snapping tour's guide goes (document units) */
const GUIDE = 250;

export const tours: Record<string, TourStep[]> = {
  booleans: [
    {
      target: () => q('#wrap'),
      enter: () => select(null),
      done: () => sel('Moon', 'Bite') && S.selSet.size === 2,
      show: () => dragDoc([140, 40], [300, 200], 900),
      clip: () => [screenBox(140, 40, 260, 220)],
    },
    {
      target: () => q('#insp [data-align="vcenter"]'),
      done: () => Math.abs(mid('Moon')[1] - mid('Bite')[1]) < 1,
      show: () => click(q('#insp [data-align="vcenter"]')),
      clip: () => [shapeEl(byName('Moon')), shapeEl(byName('Bite'))],
    },
    {
      target: () => q('#insp [data-bool="subtract"]'),
      done: () => !!byName('Subtract'),
      show: () => click(q('#insp [data-bool="subtract"]')),
      clip: () => [screenBox(160, 80, 260, 180)],
    },
    {
      target: () => q('#insp [data-align="hcenter"]'),
      enter: () => keep('Subtract'),
      done: () => Math.abs(mid('Subtract')[0] - doc.w / 2) < 1,
      show: () => click(q('#insp [data-align="hcenter"]')),
      clip: () => [screenBox(160, 80, 320, 180)],
    },
  ],

  layers: [
    {
      target: () => q('#ln'),
      enter: () => {
        const h = head();
        if (h && S.sel !== h.id) select(h.id);
      },
      done: () => !!head() && head()!.name !== 'Circle',
      show: () => type(q('#ln') as HTMLInputElement, 'Head'),
      clip: () => [lpRow(head()?.name || 'Circle')],
    },
    {
      target: () => q('#lUp'),
      enter: () => {
        if (S.sel && S.sel === byName('Scarf')?.id) select(null);
      },
      done: () => {
        const s = byName('Scarf'),
          b = byName('Body');
        return !!(s && b && doc.layers.indexOf(s) > doc.layers.indexOf(b));
      },
      show: async () => {
        await click(lpRow('Scarf'), 0.3, 0.5);
        await click(q('#lUp'));
      },
      clip: () => [lpRow('Scarf'), lpRow('Body'), shapeEl(byName('Scarf'))],
    },
    {
      target: () => q('#wrap'),
      enter: () => select(null),
      done: () => sel('Body', 'Scarf', 'Hat') && !!head() && S.selSet.has(head()!.id),
      show: () => dragDoc([230, 70], [410, 300], 900),
      clip: () => [screenBox(230, 70, 180, 260)],
    },
    {
      target: () => q('#lGroup'),
      done: () => !!snowGroup(),
      show: () => click(q('#lGroup')),
      clip: () => [q('#lp')],
    },
    {
      target: () => {
        const g = snowGroup();
        return g ? q(`#lp [data-lid="${g.id}"] [data-la="lock"]`) : null;
      },
      enter: () => {
        const g = snowGroup();
        if (g && S.sel !== g.id) select(g.id);
      },
      done: () => !!snowGroup()?.lock,
      show: () => {
        const g = snowGroup();
        return click(g ? q(`#lp [data-lid="${g.id}"] [data-la="lock"]`) : null);
      },
      clip: () => {
        const g = snowGroup();
        return [g ? lpRow(g.name) : null];
      },
    },
  ],

  hyperlinks: [
    pickRow('Button'),
    {
      target: () => rowOf('#lk-url'),
      enter: () => {
        keep('Button');
        reveal(q('#lk-url'));
      },
      done: () => !!byName('Button')?.link?.url,
      show: async () => type((await shown(() => q('#lk-url'))) as HTMLInputElement, 'svgcinema.com'),
      clip: () => [lpRow('Button')],
    },
    {
      target: () => rowOf('#lk-target'),
      enter: () => {
        keep('Button');
        reveal(q('#lk-target'));
      },
      done: () => byName('Button')?.link?.target === '_self',
      show: async () => choose((await shown(() => q('#lk-target'))) as HTMLSelectElement, '_self'),
      clip: () => [rowOf('#lk-url')],
    },
  ],

  snapping: [
    {
      target: () => q('#vGrid'),
      enter: () => VIEW.rulers && setView({ rulers: false }),
      done: () => VIEW.rulers,
      show: () => viewItem('#vGrid', 'rulers'),
      clip: () => [viewMenu(), q('#rulerX'), q('#rulerY')],
    },
    {
      target: () => q('#rulerX'),
      enter: () => {
        if (!VIEW.rulers || !VIEW.guides) setView({ rulers: true, guides: true });
      },
      done: () => !!doc.guides && doc.guides.y.some(v => Math.abs(v - GUIDE) <= 8),
      show: () => {
        const r = (q('#rulerX') as HTMLElement).getBoundingClientRect(),
          x = screenOf(470, 0).x;
        return drag({ x, y: r.top + r.height / 2 }, screenOf(470, GUIDE), { ms: 900 });
      },
      clip: () => [screenBox(0, GUIDE - 20, 640, 40)],
    },
    {
      target: () => q('#wrap'),
      enter: () => {
        if (!VIEW.snap || !VIEW.sGuides || !VIEW.guides) setView({ snap: true, sGuides: true, guides: true });
      },
      done: () => {
        const b = box('Box');
        return !!b && !!doc.guides && doc.guides.y.some(v => Math.abs(b.y + b.h - v) < 0.6);
      },
      show: async () => {
        const l = byName('Box');
        if (!l) return;
        const b = box('Box'),
          g = (doc.guides && doc.guides.y[doc.guides.y.length - 1]) || GUIDE,
          a = offCentre(l),
          // just short of the guide: snapping pulls it the rest of the way
          dy = screenOf(0, g - 2.5).y - screenOf(0, b ? b.y + b.h : 180).y;
        await drag(a, { x: a.x + screenOf(110, 0).x - screenOf(0, 0).x, y: a.y + dy }, { ms: 1000 });
      },
      clip: () => [screenBox(100, 80, 260, GUIDE - 60)],
    },
    {
      target: () => q('#vGrid'),
      enter: () => VIEW.gridFront && setView({ gridFront: false }),
      done: () => VIEW.gridFront,
      show: () => viewItem('#vGrid', 'gridFront'),
      clip: () => [viewMenu(), screenBox(0, 0, 640, 400)],
    },
    {
      target: () => q('#vSnap'),
      enter: () => (VIEW.sGrid || !VIEW.snap) && setView({ sGrid: false, snap: true }),
      done: () => VIEW.snap && VIEW.sGrid,
      show: () => viewItem('#vSnap', 'sGrid'),
      clip: () => [viewMenu()],
    },
  ],
};
