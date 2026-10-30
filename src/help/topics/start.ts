// SVGcinema — help/topics/start: Getting started (scenes and tour steps; the words are in help/content.json)
import { S, selLayer } from '../../core/state';
import { select, setTool } from '../../core/history';
import { closeFileMenu } from '../../ui/file-menu';
import { endSave } from '../../io/save';
import { closeModal } from '../../ui/topbar';
import { click, drag, hover, press, type } from '../ghost';
import {
  type Scene,
  type TourStep,
  allLayers,
  artboard,
  byName,
  keyAt,
  lock,
  lpRow,
  near,
  offCentre,
  onRuler,
  playStep,
  playheadStep,
  q,
  screenOf,
  shapeEl,
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
  // The editor at a glance: hills, a sun, and a cloud that already drifts (so the timeline has a track)
  'editor-glance': {
    name: 'Practice: the editor at a glance',
    svg: svg640(`<circle id="Sun" cx="470" cy="128" r="44" fill="#ffd36e"/>
<path id="Cloud" d="M96 118c0-18 15-32 33-32 9-17 33-22 48-10 20-6 40 8 40 28 14 2 24 13 24 26H96z" fill="#f4f1ff"/>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>`),
    setup() {
      lock('Sky', 'Hills');
      const c = byName('Cloud');
      if (c) {
        const [x, y] = (c.b.pos as number[]) || [0, 0];
        c.t.pos = [
          [0, [x, y], 'linear'],
          [3, [x + 300, y], 'linear'],
        ];
      }
    },
  },
  // Projects, saving and files: a small scene to save (the ☰ menu has the file commands)
  projects: {
    name: 'Practice: projects, saving and files',
    menu: true,
    svg: svg640(`<circle id="Sun" cx="470" cy="128" r="44" fill="#ffd36e"/>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
};

const menuOpen = () => !(q('#fileMenu') as HTMLElement).hidden;
const shown = (sel: string) => {
  const m = q(sel) as HTMLElement | null;
  return !!m && !m.hidden;
};
/** closes the ☰ menu and any dialog, so a step starts from the editor */
function calm() {
  if (shown('#mSave')) endSave(false);
  ['#mNew', '#mExport'].forEach(s => shown(s) && closeModal(q(s) as HTMLElement));
  if (menuOpen()) closeFileMenu();
}
const openMenu = async () => {
  if (!menuOpen()) await click(q('#bMenu'));
};
const sun = () => byName('Sun');
/** scrolls a field of the inspector into view, as a person would before using it */
const into = (sel: string) => {
  const e = q(sel);
  if (e) e.scrollIntoView({ block: 'nearest' });
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

  'editor-glance': [
    // the tools: M for the Rectangle
    {
      target: () => q('#tools [data-group="shapes"]'),
      enter: () => S.tool === 'rect' && setTool('select'),
      done: () => S.tool === 'rect',
      show: () => press('M', 'm', 'KeyM'),
      clip: () => [q('#tools [data-tool="select"]'), q('#tools [data-tool="text"]')],
    },
    // the canvas: draw on the artboard
    {
      target: () => q('#wrap'),
      enter: c => {
        if (S.tool !== 'rect') setTool('rect');
        c.n = allLayers().filter(l => l.type === 'rect').length;
      },
      done: c => allLayers().filter(l => l.type === 'rect').length > c.n,
      show: () => drag(screenOf(250, 236), screenOf(330, 300), { ms: 800 }),
      clip: () => [artboard()],
    },
    // the Layers panel: pick the sun
    {
      target: () => q('#lp'),
      done: () => selLayer()?.name === 'Sun',
      show: () => click(lpRow('Sun'), 0.3, 0.5),
      clip: () => [lpRow('Sun'), shapeEl(sun())],
    },
    // the inspector: move it by its numbers
    {
      target: () => q('#i-pos_1')?.closest('.row') || null,
      enter: c => {
        const l = sun();
        if (l && S.sel !== l.id) select(l.id);
        into('#i-pos_1');
        c.p = JSON.stringify(sun()?.b.pos);
      },
      done: c => JSON.stringify(sun()?.b.pos) !== c.p,
      show: () => type(q('#i-pos_1') as HTMLInputElement, '170'),
      clip: () => [shapeEl(sun())],
    },
    // the timeline: drag the playhead, the cloud drifts
    {
      target: () => q('#ruler'),
      enter: c => (c.t = S.time),
      done: c => Math.abs(S.time - c.t) > 0.5,
      show: () => drag(onRuler(S.time), onRuler(near(2) ? 1 : 2), { ms: 900 }),
      clip: () => [shapeEl(byName('Cloud'))],
    },
    // the top bar: Export
    {
      target: () => q('#bExport'),
      enter: () => calm(),
      done: () => shown('#mExport'),
      show: () => click(q('#bExport')),
      clip: () => [shown('#mExport') ? q('#mExport .dlg') : null],
    },
  ],

  projects: [
    // the ☰ menu
    {
      target: () => q('#bMenu'),
      enter: () => calm(),
      done: () => menuOpen(),
      show: () => click(q('#bMenu')),
      clip: () => [menuOpen() ? q('#fileMenu') : null],
    },
    // Save as…: the Save project dialog
    {
      target: () => (shown('#mSave') ? q('#mSave .dlg') : q('#bSaveAs')),
      enter: () => shown('#mSave') && endSave(false),
      done: () => shown('#mSave'),
      show: async () => {
        await openMenu();
        await click(q('#bSaveAs'));
      },
    },
    // Open…: a project file (the browser's own file window does the rest)
    {
      target: () => (menuOpen() ? q('#bOpen') : q('#bMenu')),
      enter: () => calm(),
      done: c => !!c.shown && menuOpen(),
      show: async c => {
        await openMenu();
        await hover(q('#bOpen'));
        c.shown = true;
      },
      clip: () => [menuOpen() ? q('#fileMenu') : null],
    },
    // New project…: a blank canvas
    {
      target: () => (shown('#mNew') ? q('#mNew .dlg') : menuOpen() ? q('#bNew') : q('#bMenu')),
      enter: () => calm(),
      done: () => shown('#mNew'),
      show: async () => {
        await openMenu();
        await click(q('#bNew'));
      },
    },
  ],
};
