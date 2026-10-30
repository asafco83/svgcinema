// SVGcinema — help/topics/io: Import and export (scenes and tour steps; the words are in help/content.json)
import { S, doc, selLayer } from '../../core/state';
import { setTime } from '../../core/history';
import { openExport } from '../../export/build';
import { type ExportKind, exportKind, showKind } from '../../export/kind';
import { scrubSettings, syncExportUI } from '../../export/dialog';
import { updateExport } from '../../export/images';
import { fwSel } from '../../export/snippets';
import { syncStillUI } from '../../export/still';
import { importSVG } from '../../io/svg-import';
import { closeFileMenu } from '../../ui/file-menu';
import { closeModal } from '../../ui/topbar';
import { type XY, centre, click, hover, moveTo, type } from '../ghost';
import {
  type Scene,
  type TourStep,
  artboard,
  byName,
  lock,
  lpRow,
  offEditor,
  pause,
  playStep,
  q,
  screenOf,
  shapeEl,
  svg640,
  trackBits,
} from '../kit';

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** waits until `ok` is true (at most `ms`) */
async function until(ok: () => boolean, ms = 6000) {
  for (let t = 0; t < ms && !ok(); t += 100) await wait(100);
}

/* ---------------- scenes ---------------- */

/** The export tutorials' scene: a balloon that rises and sinks over the hills, a cloud that drifts. */
const BALLOON = svg640(`<circle id="Sun" cx="500" cy="104" r="38" fill="#ffd36e"/>
<path id="Cloud" d="M96 118c0-18 15-32 33-32 9-17 33-22 48-10 20-6 40 8 40 28 14 2 24 13 24 26H96z" fill="#f4f1ff"/>
<g id="Balloon">
<path id="Envelope" d="M320 70c-38 0-64 28-64 62 0 30 26 54 50 72h28c24-18 50-42 50-72 0-34-26-62-64-62z" fill="#ff6b5b"/>
<path id="Stripe" d="M320 70c-14 0-24 28-24 62 0 30 10 54 18 72h12c8-18 18-42 18-72 0-34-10-62-24-62z" fill="#ffd36e"/>
<path id="Ropes" d="M308 204l5 25M332 204l-5 25" fill="none" stroke="#3a2a4a" stroke-width="2"/>
<rect id="Basket" x="309" y="228" width="22" height="18" rx="3" fill="#8a5a3c"/>
</g>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>`);
function balloonSetup() {
  lock('Sky', 'Sun', 'Hills');
  const b = byName('Balloon'),
    c = byName('Cloud');
  if (b) {
    const [x, y] = (b.b.pos as number[]) || [0, 0];
    b.t.pos = [
      [0, [x, y + 90], 'ease'],
      [1.5, [x, y - 30], 'ease'],
      [3, [x, y + 90], 'ease'],
    ];
    b.t.rot = [
      [0, -4, 'ease'],
      [1.5, 4, 'ease'],
      [3, -4, 'ease'],
    ];
  }
  if (c) {
    const [x, y] = (c.b.pos as number[]) || [0, 0];
    c.t.pos = [
      [0, [x, y], 'ease'],
      [1.5, [x + 60, y], 'ease'],
      [3, [x, y], 'ease'],
    ];
  }
}
const balloonScene = (title: string): Scene => ({ name: 'Practice: ' + title, svg: BALLOON, setup: balloonSetup });

/** A photo for "Images and photos in exports": a big JPEG (1600 × 1000, with grain like a real photo's), drawn
 *  the first time the scene opens. */
let PHOTO = '';
function photo() {
  if (PHOTO) return PHOTO;
  const W = 1600,
    H = 1000,
    cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d');
  if (!x) return '';
  const sky = x.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, '#5b7fc4');
  sky.addColorStop(1, '#f6c48f');
  x.fillStyle = sky;
  x.fillRect(0, 0, W, H);
  x.fillStyle = '#fff1c9';
  x.beginPath();
  x.arc(1120, 430, 70, 0, Math.PI * 2);
  x.fill();
  // ridges, far to near
  const ridge = (base: number, amp: number, f: number, col: string) => {
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(0, H);
    for (let i = 0; i <= W; i += 8)
      x.lineTo(
        i,
        base - amp * (Math.sin(i * f) * 0.6 + Math.sin(i * f * 2.7 + 1.3) * 0.3 + Math.sin(i * f * 6.1) * 0.1),
      );
    x.lineTo(W, H);
    x.fill();
  };
  ridge(560, 110, 0.004, '#8d7aa8');
  ridge(640, 90, 0.006, '#5d5687');
  ridge(720, 70, 0.009, '#3a3c66');
  const lake = x.createLinearGradient(0, 760, 0, H);
  lake.addColorStop(0, '#e9b48a');
  lake.addColorStop(1, '#4b5d8f');
  x.fillStyle = lake;
  x.fillRect(0, 780, W, H - 780);
  let s = 7;
  const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  // pines along the shore, ripples on the lake
  x.fillStyle = '#23264a';
  for (let i = 0; i < 260; i++) {
    const tx = rnd() * W,
      th = 30 + rnd() * 70,
      tw = th * (0.28 + rnd() * 0.12),
      ty = 790 - rnd() * 40;
    x.beginPath();
    x.moveTo(tx, ty - th);
    x.lineTo(tx + tw / 2, ty);
    x.lineTo(tx - tw / 2, ty);
    x.fill();
  }
  for (let i = 0; i < 500; i++) {
    x.fillStyle = `rgba(255,236,200,${0.08 + rnd() * 0.22})`;
    x.fillRect(rnd() * W, 800 + rnd() * 200, 20 + rnd() * 90, 1 + rnd() * 2);
  }
  // grain
  const im = x.getImageData(0, 0, W, H),
    d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    const n = ((s >> 16) % 13) - 6;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  x.putImageData(im, 0, 0);
  PHOTO = cv.toDataURL('image/jpeg', 0.9);
  return PHOTO;
}

/** The SVG file "Show me" drops on the canvas: a moon whose glow pulses (a CSS animation). */
const MOON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
<title>Moon</title>
<style>#Glow{animation:glow 3s ease-in-out infinite}@keyframes glow{0%{opacity:.2}50%{opacity:.75}100%{opacity:.2}}</style>
<circle id="Glow" cx="80" cy="80" r="76" fill="#fff3c4"/>
<circle id="Disc" cx="80" cy="80" r="52" fill="#ffe9a8"/>
<circle id="Crater" cx="62" cy="66" r="12" fill="#f0d488"/>
<circle id="Dimple" cx="98" cy="100" r="8" fill="#f0d488"/>
</svg>`;
/** The markup "Show me" pastes into the Import window. */
const STAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path id="Star" d="M50 6l13 28 30 4-22 21 6 30-27-15-27 15 6-30L7 38l30-4z" fill="#ffd36e"/></svg>`;

export const scenes: Record<string, Scene> = {
  // Opening and importing SVG: an empty night sky to drop a moon on (the ☰ menu has Import and Open)
  'import-svg': {
    name: 'Practice: opening and importing SVG',
    menu: true,
    svg: svg640(`<path id="Ground" d="M0 318c120-14 230-16 340-8s210 12 300 0v90H0z" fill="#1f2b5c"/>`),
    setup() {
      lock('Sky', 'Ground');
    },
  },
  'export-svg': balloonScene('export an animated SVG'),
  starts: balloonScene('when it starts'),
  scroll: balloonScene('linked to scroll'),
  'player-api': balloonScene('the player API'),
  video: balloonScene('video'),
  gif: balloonScene('GIF and animated WebP'),
  stills: balloonScene('still images'),
  // Images and photos in exports: a postcard with a big photo on it, swaying
  'export-images': {
    name: 'Practice: images and photos in exports',
    get svg() {
      return svg640(`<g id="Postcard">
<rect id="Card" x="150" y="56" width="340" height="252" rx="6" fill="#fbf7ef"/>
<image id="Photo" x="166" y="72" width="308" height="192" href="${photo()}"/>
</g>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>`);
    },
    setup() {
      lock('Sky', 'Hills');
      const p = byName('Postcard');
      if (p)
        p.t.rot = [
          [0, -3, 'ease'],
          [1.5, 3, 'ease'],
          [3, -3, 'ease'],
        ];
    },
  },
};

/* ---------------- helpers ---------------- */

const shown = (sel: string) => {
  const m = q(sel) as HTMLElement | null;
  return !!m && !m.hidden;
};
const menuOpen = () => shown('#fileMenu');
const exportOpen = () => shown('#mExport');
const openMenu = async () => {
  if (!menuOpen()) await click(q('#bMenu'));
};
/** closes the ☰ menu and the windows, so a step starts from the editor */
function calm() {
  ['#mExport', '#mImport', '#mImpRep'].forEach(s => shown(s) && closeModal(q(s) as HTMLElement));
  if (menuOpen()) closeFileMenu();
}
/** scrolls a control into view, as a person would before using it */
const into = (sel: string, block: ScrollLogicalPosition = 'nearest') => {
  const e = q(sel);
  if (e) e.scrollIntoView({ block });
};
/** The Export window open on a kind, on its Preview tab, with these sections open (a person may have closed
 *  them: the dialog remembers it). */
function inExport(k: ExportKind, ...secs: string[]) {
  if (menuOpen()) closeFileMenu();
  if (!exportOpen()) openExport();
  if (exportKind() !== k) showKind(k);
  if (shown('#xPaneEmbed')) (q('#xTab [data-v="preview"]') as HTMLElement).click();
  secs.forEach(id => {
    const s = q('#' + id);
    if (s && s.classList.contains('closed')) (s.querySelector('h3') as HTMLElement).click();
  });
}
/** Animated SVG settings a step starts from (changed only when they differ, so the preview isn't rebuilt
 *  for nothing) */
function svgSet(o: Partial<typeof doc.ex>) {
  const ex = doc.ex as any;
  if (Object.keys(o).every(k => ex[k] === (o as any)[k])) return;
  Object.assign(ex, o);
  syncExportUI();
  updateExport();
}
/** Pick an option of a drop-down the way a person does: click it, then the choice (a native list can't be
 *  opened by script, so the pick is the value changing, with the change event the editor handles). */
async function choose(sel: HTMLSelectElement | null, value: string) {
  if (!sel) return;
  await click(sel);
  await wait(250);
  sel.value = value;
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(400);
}
/** Drag a slider's thumb to a value: the pointer moves with it, and the slider gets the input events a drag
 *  gives (a native slider can't be dragged by script), then change. */
async function slide(r: HTMLInputElement | null, value: number, ms = 700) {
  if (!r) return;
  const min = +r.min || 0,
    max = +r.max || 100,
    box = r.getBoundingClientRect(),
    xOf = (v: number) => box.left + 8 + ((v - min) / (max - min)) * (box.width - 16),
    y = box.top + box.height / 2,
    v0 = +r.value;
  await moveTo({ x: xOf(v0), y });
  const n = Math.max(6, Math.round(ms / 40));
  for (let i = 1; i <= n; i++) {
    const v = v0 + ((value - v0) * i) / n;
    r.value = String(Math.round(v / (+r.step || 1)) * (+r.step || 1));
    r.dispatchEvent(new Event('input', { bubbles: true }));
    await moveTo({ x: xOf(v), y }, { ms: 30 });
  }
  r.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(400);
}
/** Scroll a box that scrolls on its own, as a mouse wheel does, a little at a time. */
async function scrollBy(el: HTMLElement | null, dy: number, ms = 1200) {
  if (!el) return;
  await moveTo(centre(el, 0.5, 0.55));
  const n = Math.max(1, Math.round(ms / 40)),
    from = el.scrollTop;
  for (let i = 1; i <= n; i++) {
    const t = i / n,
      e = t * t * (3 - 2 * t);
    el.scrollTop = from + dy * e;
    await wait(40);
  }
  await wait(500);
}
/** Paste text into a text box (Ctrl V on the pointer, the text arrives with the input event a paste gives). */
async function paste(ta: HTMLTextAreaElement | null, text: string) {
  if (!ta) return;
  await click(ta);
  ta.focus();
  const k = q('.tg-ghost .tg-key') as HTMLElement | null;
  if (k) {
    k.textContent = 'Ctrl V';
    k.hidden = false;
  }
  await wait(300);
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(500);
  if (k) k.hidden = true;
}
/** Drop a file on the canvas, as from the computer's files: the pointer comes in from below the window with
 *  the file's name beside it, and the canvas gets the drag and drop events (with the file) a real drop gives. */
async function dropFile(name: string, text: string, at: XY) {
  const file = new File([text], name, { type: 'image/svg+xml' }),
    dt = new DataTransfer();
  dt.items.add(file);
  await moveTo(at, { from: { x: at.x - 220, y: innerHeight + 40 }, label: name, ms: 1000 });
  const t =
    document.elementsFromPoint(at.x, at.y).find(e => !e.closest('.tg-card, .tg-ghost, .tg-spot')) || document.body;
  const ev = (type: string) =>
    t.dispatchEvent(
      new DragEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, dataTransfer: dt }),
    );
  ev('dragenter');
  ev('dragover');
  await wait(200);
  ev('drop');
  await wait(600);
}
/** the Export preview's own SVG and its player */
const prevSvg = () => q('#xprev svg') as (SVGSVGElement & { player?: any }) | null;
const prevPlayer = () => {
  const s = prevSvg();
  return s && s.player ? s.player : null;
};
/** listens for a click on a control once (a step done by pressing a button that changes nothing on screen) */
function onClick(sel: string, c: Record<string, any>, flag: string) {
  const b = q(sel);
  if (b) b.addEventListener('click', () => (c[flag] = true), { once: true });
}

/* ---------------- steps used by several topics ---------------- */

const KIND = (k: ExportKind) => q(`#xKind [data-v="${k}"]`);
/** "Open Export": the Export button, then the kind in the window's picker (it opens on the kind used last). */
const openStep = (k: ExportKind): TourStep => ({
  target: () => (exportOpen() ? KIND(k) : q('#bExport')),
  enter: () => {
    pause();
    calm();
  },
  done: () => exportOpen() && exportKind() === k,
  show: async () => {
    if (!exportOpen()) await click(q('#bExport'));
    if (exportKind() !== k) await click(KIND(k));
  },
  clip: () => [exportOpen() ? q('#mExport .dlg') : null],
});
/** "Download it": the footer's main button (it makes the file, then the browser saves it). */
const downloadStep = (k: ExportKind, ready: () => boolean = () => true, after = 0): TourStep => ({
  target: () => q('#xDl'),
  enter: c => {
    inExport(k);
    onClick('#xDl', c, 'dl');
  },
  done: c => !!c.dl,
  show: async () => {
    await until(ready);
    await click(q('#xDl'));
    if (after) await wait(after);
  },
  clip: () => [q('#xFootSize'), q('#xProg')],
});

/* ---------------- tours ---------------- */

/** the group the last import made (the scene itself has none) */
const imported = () =>
  doc.layers.filter(l => l.type === 'group' && !l.parent && l.name !== 'Imported SVG').pop() || null;
const inside = (name: string) => {
  const g = imported();
  if (!g) return null;
  const kids = doc.layers.filter(l => l.parent === g.id);
  return kids.find(l => l.name === name) || kids[0] || null;
};

export const tours: Record<string, TourStep[]> = {
  'import-svg': [
    // drop an SVG file on the canvas
    {
      target: () => q('#wrap'),
      enter: c => {
        calm();
        c.n = doc.layers.length;
      },
      done: c => doc.layers.length > c.n,
      show: () => dropFile('Moon.svg', MOON, screenOf(150, 112)),
      clip: () => [artboard(), lpRow('Moon')],
    },
    // its layers, named from its ids
    {
      target: () => q('#lp'),
      enter: () => {
        // a person who came here another way: the moon, as the drop brings it
        if (!imported()) importSVG(MOON, false, 'Moon', { x: 150, y: 112 });
      },
      done: () => {
        const l = selLayer();
        return !!l && !!l.parent;
      },
      show: () => click(lpRow(inside('Crater')?.name || ''), 0.4, 0.5),
      clip: () => [lpRow(imported()?.name || ''), shapeEl(inside('Crater'))],
    },
    // its CSS animation is keyframes now: play it
    {
      ...playStep(),
      enter: () => {
        pause();
        setTime(0);
      },
      clip: () => [artboard(), ...trackBits(inside('Glow'), 'op')],
    },
    // ☰ › Import files…
    {
      target: () => (shown('#mImport') ? q('#mImport .dlg') : menuOpen() ? q('#bImport') : q('#bMenu')),
      enter: () => {
        pause();
        calm();
      },
      done: () => shown('#mImport'),
      show: async () => {
        await openMenu();
        await click(q('#bImport'));
      },
    },
    // paste SVG markup, Import
    {
      target: () => (shown('#mImport') ? q('#mImport .dlg') : null),
      enter: c => {
        if (menuOpen()) closeFileMenu();
        if (!shown('#mImport')) (q('#bImport') as HTMLElement).click();
        c.n = doc.layers.length;
      },
      done: c => doc.layers.length > c.n,
      show: async () => {
        await paste(q('#iText') as HTMLTextAreaElement, STAR);
        await click(q('#iGo'));
      },
      clip: () => [shown('#mImport') ? q('#mImport .dlg') : null, shapeEl(byName('Star'))],
    },
    // ☰ › Open… opens an SVG as a new project
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
  ],

  'export-svg': [
    openStep('svg'),
    // Format: what the JavaScript export supports (and CSS only)
    {
      target: () => q('#xAbout summary'),
      enter: () => {
        inExport('svg', 'xSecFmt');
        svgSet({ mode: 'js' });
        (q('#xAbout') as HTMLDetailsElement).open = false;
      },
      done: () => (q('#xAbout') as HTMLDetailsElement).open,
      show: () => click(q('#xAbout summary')),
      clip: () => [q('#xMode'), q('#xAbout')],
    },
    // Size: Responsive or Fixed
    {
      target: () => q('#xSize'),
      enter: () => {
        inExport('svg', 'xSecSize');
        svgSet({ size: 'resp' });
        into('#xSecSize', 'start');
      },
      done: () => doc.ex.size === 'fixed',
      show: () => click(q('#xSize [data-v="fixed"]')),
      clip: () => [q('#xSecSize')],
    },
    // Embed in your site
    {
      target: () => q('#xTab [data-v="embed"]'),
      enter: () => inExport('svg'),
      done: () => shown('#xPaneEmbed'),
      show: () => click(q('#xTab [data-v="embed"]')),
      clip: () => [shown('#xPaneEmbed') ? q('#xSvgEmbed') : null],
    },
    // Download .svg
    {
      ...downloadStep('svg'),
      enter: c => {
        if (menuOpen()) closeFileMenu();
        if (!exportOpen()) openExport();
        if (exportKind() !== 'svg') showKind('svg');
        onClick('#xDl', c, 'dl');
      },
    },
  ],

  starts: [
    openStep('svg'),
    // Starts › On mouse over
    {
      target: () => q('#xTrig'),
      enter: () => {
        inExport('svg', 'xSecPlay');
        svgSet({ mode: 'js', trigger: 'load' });
        into('#xTrig');
      },
      done: () => doc.ex.trigger === 'hover',
      show: () => choose(q('#xTrig') as HTMLSelectElement, 'hover'),
      clip: () => [q('#xOutRow')],
    },
    // try it in the preview: over it, it plays; away, it pauses
    {
      target: () => prevSvg(),
      enter: () => {
        inExport('svg', 'xSecPlay');
        svgSet({ mode: 'js', trigger: 'hover' });
      },
      done: () => !!prevPlayer()?.isPlaying,
      show: async () => {
        await until(() => !!prevPlayer());
        const s = prevSvg();
        if (!s) return;
        await moveTo(centre(s, 0.55, 0.45), { ms: 700 });
        for (const ty of ['pointerover', 'pointerenter', 'mouseover'])
          s.dispatchEvent(new MouseEvent(ty, { bubbles: ty.endsWith('over'), clientX: 0, clientY: 0 }));
        s.dispatchEvent(new MouseEvent('mouseenter'));
        await wait(1600);
        const r = s.getBoundingClientRect();
        await moveTo({ x: r.right + 40, y: r.top + r.height * 0.45 }, { ms: 500 });
        for (const ty of ['pointerout', 'pointerleave', 'mouseout'])
          s.dispatchEvent(new MouseEvent(ty, { bubbles: ty.endsWith('out') }));
        s.dispatchEvent(new MouseEvent('mouseleave'));
        await wait(600);
      },
      clip: () => [q('#xprev')],
    },
    // Starts › On click
    {
      target: () => q('#xTrig'),
      enter: () => {
        inExport('svg', 'xSecPlay');
        svgSet({ mode: 'js' });
        into('#xTrig');
      },
      done: () => doc.ex.trigger === 'click',
      show: () => choose(q('#xTrig') as HTMLSelectElement, 'click'),
      clip: () => [q('#xOutRow')],
    },
    // click the preview
    {
      target: () => prevSvg(),
      enter: () => {
        inExport('svg', 'xSecPlay');
        svgSet({ mode: 'js', trigger: 'click' });
      },
      done: () => !!prevPlayer()?.isPlaying,
      show: async () => {
        await until(() => !!prevPlayer());
        await click(prevSvg(), 0.55, 0.45);
        await wait(1000);
      },
      clip: () => [q('#xprev')],
    },
  ],

  scroll: [
    openStep('svg'),
    // Starts › Linked to scroll
    {
      target: () => q('#xTrig'),
      enter: () => {
        inExport('svg', 'xSecPlay');
        svgSet({ mode: 'js', trigger: 'load' });
        into('#xTrig');
      },
      done: () => doc.ex.trigger === 'scrub',
      show: () => choose(q('#xTrig') as HTMLSelectElement, 'scrub'),
      clip: () => [q('#xScrubRows'), q('#xprev')],
    },
    // scroll the test page
    {
      target: () => q('#xsPage'),
      enter: c => {
        inExport('svg', 'xSecPlay');
        svgSet({ mode: 'js', trigger: 'scrub' });
        c.page = null;
      },
      done: c => {
        const p = q('#xsPage') as HTMLElement | null;
        if (!p) return false;
        // the page is made again whenever a setting changes: measure from the one there now
        if (p !== c.page) {
          c.page = p;
          c.top = p.scrollTop;
        }
        return Math.abs(p.scrollTop - c.top) > 60;
      },
      show: async () => {
        await until(() => !!q('#xsPage svg'));
        const p = q('#xsPage') as HTMLElement;
        await scrollBy(p, Math.min(260, p.scrollHeight - p.clientHeight - p.scrollTop));
      },
      clip: () => [q('#xprev')],
    },
    // Plays: while it scrolls in, until centred
    {
      target: () => q('#xsRange'),
      enter: () => {
        inExport('svg', 'xSecPlay');
        svgSet({ mode: 'js', trigger: 'scrub' });
        into('#xsRange');
      },
      done: () => doc.ex.trigger === 'scrub' && scrubSettings().range === 'in',
      show: () => choose(q('#xsRange') as HTMLSelectElement, 'in'),
      clip: () => [q('#xprev')],
    },
    // Embed in your site: inline, or an <object> from the same site
    {
      target: () => q('#xTab [data-v="embed"]'),
      enter: () => {
        inExport('svg');
        svgSet({ mode: 'js', trigger: 'scrub' });
      },
      done: () => shown('#xPaneEmbed'),
      show: () => click(q('#xTab [data-v="embed"]')),
      clip: () => [shown('#xPaneEmbed') ? q('#xFwNote') : null],
    },
  ],

  'export-images': [
    openStep('svg'),
    // Images › Image sizes: each image before → after
    {
      target: () => q('#xImgDet summary'),
      enter: () => {
        inExport('svg', 'xImgGrp');
        svgSet({ mode: 'js', opt: true });
        (q('#xImgDet') as HTMLDetailsElement).open = false;
        into('#xImgGrp');
      },
      done: () => (q('#xImgDet') as HTMLDetailsElement).open,
      show: async () => {
        await until(() => /→/.test(q('#xImgList')?.textContent || ''));
        await click(q('#xImgDet summary'));
        // then down the options, to the list it opened
        const col = q('#xOptsSvg') as HTMLElement,
          list = q('#xImgList') as HTMLElement;
        await scrollBy(
          col,
          Math.max(0, list.getBoundingClientRect().bottom - col.getBoundingClientRect().bottom + 12),
          700,
        );
      },
      clip: () => [q('#xImgGrp')],
    },
    // Format: one of your own
    {
      target: () => q('#xFmt'),
      enter: () => {
        inExport('svg', 'xImgGrp');
        svgSet({ mode: 'js', opt: true });
        into('#xFmtRow');
      },
      done: () => doc.ex.opt !== false && doc.ex.fmt !== 'auto',
      show: () => {
        const s = q('#xFmt') as HTMLSelectElement;
        return choose(s, s.querySelector('option[value="webp"]') ? 'webp' : 'jpeg');
      },
      clip: () => [q('#xImgGrp')],
    },
    // Size › Largest width
    {
      target: () => q('#xMaxW'),
      enter: () => {
        inExport('svg', 'xSecSize', 'xImgGrp');
        svgSet({ mode: 'js', size: 'resp' });
        into('#xMaxRow');
      },
      done: () => doc.ex.maxW === 960,
      show: () => type(q('#xMaxW') as HTMLInputElement, '960'),
      clip: () => [q('#xMaxRow'), q('#xImgGrp')],
    },
  ],

  'player-api': [
    openStep('svg'),
    // Format › Player: External
    {
      target: () => q('#xPlayer'),
      enter: () => {
        inExport('svg', 'xSecFmt');
        svgSet({ mode: 'js', player: 'embed' });
      },
      done: () => doc.ex.player === 'external',
      show: () => click(q('#xPlayer [data-v="external"]')),
      clip: () => [q('#xPlayerNote')],
    },
    // Embed in your site › Player API
    {
      target: () => (shown('#xPaneEmbed') ? q('#xFw [data-v="api"]') : q('#xTab [data-v="embed"]')),
      enter: () => {
        inExport('svg');
        svgSet({ mode: 'js' });
        if (fwSel === 'api') (q('#xFw [data-v="html"]') as HTMLElement).click();
      },
      done: () => shown('#xPaneEmbed') && fwSel === 'api',
      show: async () => {
        if (!shown('#xPaneEmbed')) await click(q('#xTab [data-v="embed"]'));
        await click(q('#xFw [data-v="api"]'));
      },
      clip: () => [shown('#xPaneEmbed') ? q('#xSnip') : null],
    },
    // Copy snippet
    {
      target: () => q('#xSnipCopy'),
      enter: c => {
        if (!exportOpen()) openExport();
        if (exportKind() !== 'svg') showKind('svg');
        if (!shown('#xPaneEmbed')) (q('#xTab [data-v="embed"]') as HTMLElement).click();
        if (fwSel !== 'api') (q('#xFw [data-v="api"]') as HTMLElement).click();
        onClick('#xSnipCopy', c, 'copied');
      },
      done: c => !!c.copied,
      show: () => click(q('#xSnipCopy')),
      clip: () => [q('#xSnip')],
    },
    offEditor(),
    offEditor(),
  ],

  video: [
    openStep('video'),
    // File: WebM
    {
      target: () => q('#xvFmt'),
      enter: () => inExport('video', 'xvSecFmt'),
      done: () => (doc.ex.vid?.fmt || 'mp4') === 'webm',
      show: () => click(q('#xvFmt [data-v="webm"]')),
      clip: () => [q('#xvSecFmt')],
    },
    // Size › Frame: Square
    {
      target: () => q('#xvPreset'),
      enter: () => {
        inExport('video', 'xvSecSize');
        into('#xvPreset');
      },
      done: () => doc.ex.vid?.preset === 'sq',
      show: () => choose(q('#xvPreset') as HTMLSelectElement, 'sq'),
      clip: () => [q('#xvSecSize'), q('#xvStage')],
    },
    // Fit: Fill (crop)
    {
      target: () => q('#xvFit'),
      enter: () => {
        inExport('video', 'xvSecSize');
        into('#xvFitRow');
      },
      done: () => doc.ex.vid?.fit === 'fill',
      show: () => click(q('#xvFit [data-v="fill"]')),
      clip: () => [q('#xvStage')],
    },
    // Export .webm: it encodes, then saves
    downloadStep('video', () => true, 1600),
  ],

  gif: [
    openStep('anim'),
    // Size › Scale: 50%
    {
      target: () => q('#xaScale'),
      enter: () => {
        inExport('anim', 'xaSecSize');
        into('#xaScaleRow');
      },
      done: () => doc.ex.anim?.scale === '50',
      show: () => click(q('#xaScale [data-v="50"]')),
      clip: () => [q('#xaSecSize'), q('#xaPrev .xa-banner')],
    },
    // Compression › Colors: fewer
    {
      target: () => q('#xaColRow'),
      enter: () => {
        inExport('anim', 'xaSecGif');
        into('#xaColRow');
      },
      done: () => (doc.ex.anim?.colours ?? 128) < 128,
      show: () => slide(q('#xaCol') as HTMLInputElement, 48),
      clip: () => [q('#xaPrev .xa-banner')],
    },
    // compare with the original: the divider
    {
      target: () => q('#xaBox'),
      enter: c => {
        inExport('anim');
        c.v = (q('#xaSplit') as HTMLInputElement).value;
      },
      done: c => (q('#xaSplit') as HTMLInputElement).value !== c.v,
      show: async () => {
        await until(() => !!doc.ex.anim && !/…/.test(q('#xaSize')?.textContent || '…'));
        await slide(q('#xaSplit') as HTMLInputElement, 22, 900);
      },
      clip: () => [q('#xaBox')],
    },
    // Play the file
    {
      target: () => q('#xaPlay'),
      enter: () => inExport('anim'),
      done: () => !!q('#xaPlay')?.classList.contains('on'),
      show: async () => {
        await click(q('#xaPlay'));
        await wait(1200);
      },
      clip: () => [q('#xaBox')],
    },
    downloadStep('anim'),
  ],

  stills: [
    openStep('image'),
    // Frame › Time: 1.5 s
    {
      target: () => q('#xiTime'),
      enter: () => {
        inExport('image', 'xiSecFrame');
        if (Math.abs(S.time - 1.5) < 0.02) {
          setTime(0);
          syncStillUI();
        }
      },
      done: () => Math.abs(S.time - 1.5) < 0.02,
      show: () => type(q('#xiTime') as HTMLInputElement, '1.5'),
      clip: () => [q('#xiPh'), q('#xiBox')],
    },
    // Format: WebP
    {
      target: () => q('#xiFmt'),
      enter: () => inExport('image', 'xiSecFmt'),
      done: () => doc.ex.img?.fmt === 'webp',
      show: () => click(q('#xiFmt [data-v="webp"]')),
      clip: () => [q('#xiSecFmt')],
    },
    // Size › Scale: 1×
    {
      target: () => q('#xiScale'),
      enter: () => {
        inExport('image', 'xiSecSize');
        into('#xiScaleRow');
      },
      done: () => doc.ex.img?.scale === '1',
      show: () => click(q('#xiScale [data-v="1"]')),
      clip: () => [q('#xiSecSize')],
    },
    downloadStep('image', () => /KB|MB|B$/.test(q('#xFileSize')?.textContent || '')),
  ],
};
