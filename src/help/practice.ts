// SVGcinema — help/practice
// The practice editor: index.html?tour=<topic> (core/batch-mode PRACTICE). It opens the tutorial's own
// scene (help/scenes), keeps nothing in the browser, marks its top bar "Practice" with an Exit button,
// and runs the guided tour: the control for the step stays lit while the rest dims, a card says what to
// do and waits until it is done (help/tours), "Show me" does it with a pointer to watch (help/ghost).
//
// Where it runs:
// - in the editor, in a frame over the editor with the Help panel beside it (ui/help-panel): &panel=1.
//   The panel lists the steps, so the card here is short. The two talk with postMessage (same origin):
//   this page sends {svgcinema:'tour', …state} after every change and {svgcinema:'tour-exit'}; the panel
//   sends {svgcinema:'tour-cmd', cmd:'show'|'back'|'next'|'exit'}.
// - on the website, in a lightbox over the topic page: the full card (the page closes the lightbox on
//   tour-exit).
// - on its own (a direct link, a narrow screen): the full card; Exit opens the editor with your project.
import { $, esc } from '../core/constants';
import { S, doc } from '../core/state';
import { TOUR } from '../core/batch-mode';
import { importSVG } from '../io/svg-import';
import { renderAll } from '../render/stage';
import { buildProject } from '../io/zip';
import { downloadProject } from '../io/save';
import { updateFileInfo } from '../io/file-state';
import { setTlHeight } from '../ui/tl-resize';
import { SCENES } from './scenes';
import { TOURS, type Ctx } from './tours';
import { topic, rich } from './content';
import { addBox, ghostBox, hideGhost, resetGhostBox } from './ghost';

const PANEL = /[?&]panel=1/.test(location.search);
/** recording the help clips (site/captures.py): no card, and the tour moves on only when told (next) */
const CLIP = /[?&]clip=1/.test(location.search);
const HOSTED = window.parent !== window;
const EXIT_IC =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3H3v10h3M10.5 5L13.5 8l-3 3M13.5 8H6"/></svg>';
const DL_IC =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.8 7.5L8 10.7l3.2-3.2M3 13.5h10"/></svg>';

const T = {
  i: 0,
  done: [] as boolean[],
  ctx: {} as Ctx,
  /** the step was already done when the tour came to it (Back): it waits for Next instead of moving on */
  wasDone: false,
  showing: false,
  finished: false,
  timer: 0 as any,
};
let spot: HTMLElement, card: HTMLElement;

const steps = () => TOURS[TOUR] || [];
const info = () => topic(TOUR);

/** The state the Help panel (or the website) shows. */
export function tourState() {
  const t = info();
  return {
    id: TOUR,
    title: t ? t.title : '',
    i: T.i,
    n: steps().length,
    done: T.done.slice(),
    finished: T.finished,
    showing: T.showing,
  };
}
function post(msg: Record<string, unknown>) {
  if (!HOSTED) return;
  try {
    window.parent.postMessage({ svgcinema: 'tour', ...msg }, location.origin);
  } catch (_) {
    /* the page around this one went away */
  }
}
const send = () => post(tourState());

/** Exit: back to the editor underneath (or the page around this one). */
export function exitPractice() {
  if (HOSTED) {
    try {
      window.parent.postMessage({ svgcinema: 'tour-exit' }, location.origin);
      return;
    } catch (_) {
      /* fall through */
    }
  }
  location.href = location.pathname;
}
async function download() {
  const blob = await buildProject(true, []);
  await downloadProject(doc.name.replace(/^Practice: /, '') || 'Practice', blob);
}

function enter(i: number) {
  T.i = Math.max(0, Math.min(steps().length - 1, i));
  T.ctx = {};
  T.finished = false;
  const s = steps()[T.i];
  if (s && s.enter) s.enter(T.ctx);
  T.wasDone = !!(s && s.done(T.ctx));
  render();
  send();
}
/** What a step's clip shows (site/captures.py crops it to this): the lit control, what the step says its
 *  clip must show, and where the pointer went, while Show me runs. */
function sample() {
  const s = steps()[T.i];
  if (!s) return;
  const t = s.target();
  if (t && t.isConnected && !t.closest('[hidden]')) {
    const r = t.getBoundingClientRect();
    if (r.width < innerWidth * 0.45 && r.height < innerHeight * 0.45) addBox(r);
  }
  if (s.clip)
    for (const x of s.clip()) {
      if (!x) continue;
      if (x instanceof Element) {
        if (x.isConnected && !x.closest('[hidden]')) addBox(x.getBoundingClientRect());
      } else addBox(x);
    }
}
function region() {
  const b = ghostBox();
  return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
}
async function show() {
  const s = steps()[T.i];
  if (!s || T.showing) return;
  T.showing = true;
  resetGhostBox();
  sample();
  render();
  send();
  try {
    await s.show(T.ctx);
  } finally {
    T.showing = false;
    hideGhost();
    sample();
    tick();
    render();
    send();
  }
}
function next() {
  if (T.i < steps().length - 1) enter(T.i + 1);
}
function back() {
  if (T.i > 0) enter(T.i - 1);
}

/** Checks the step and keeps the light and the card on the control as the editor redraws. */
function tick() {
  const s = steps()[T.i];
  if (!s) return;
  if (!T.finished && !T.done[T.i] && s.done(T.ctx) && !T.wasDone) {
    T.done[T.i] = true;
    render();
    send();
    const at = T.i;
    if (CLIP) return;
    setTimeout(() => {
      if (T.i !== at) return;
      if (at === steps().length - 1) {
        T.finished = true;
        render();
        send();
      } else enter(at + 1);
    }, 900);
  }
  if (T.showing) sample();
  place();
}

function place() {
  const s = steps()[T.i];
  const t = !T.finished && s ? s.target() : null;
  const r = t && t.isConnected && !t.closest('[hidden]') ? t.getBoundingClientRect() : null;
  if (r && r.width && r.height) {
    spot.hidden = false;
    // the canvas is lit as a whole: the light hugs it without the dim covering what is drawn on it
    const pad = 4;
    Object.assign(spot.style, {
      left: r.left - pad + 'px',
      top: r.top - pad + 'px',
      width: r.width + pad * 2 + 'px',
      height: r.height + pad * 2 + 'px',
    });
  } else spot.hidden = true;
  // the card: under the control when there is room, else above it, else beside it; inside the window
  const cw = card.offsetWidth,
    ch = card.offsetHeight,
    W = innerWidth,
    Hh = innerHeight,
    gap = 14;
  let x: number, y: number, side: string;
  if (!r) {
    x = W - cw - 24;
    y = Hh - ch - 24;
    side = 'none';
  } else if (r.height > Hh * 0.45) {
    // a big area (the canvas): at its lower right, mostly over the timeline, so the artboard stays free
    x = r.right - cw - 12;
    y = Math.min(r.bottom + 8, Hh - ch - 8);
    side = 'none';
  } else if (r.bottom + gap + ch < Hh - 8) {
    x = r.left + r.width / 2 - cw / 2;
    y = r.bottom + gap;
    side = 'up';
  } else if (r.top - gap - ch > 8) {
    x = r.left + r.width / 2 - cw / 2;
    y = r.top - gap - ch;
    side = 'down';
  } else {
    x = r.left - cw - gap;
    y = r.top + r.height / 2 - ch / 2;
    side = 'right';
  }
  x = Math.max(8, Math.min(W - cw - 8, x));
  y = Math.max(8, Math.min(Hh - ch - 8, y));
  card.style.left = x + 'px';
  card.style.top = y + 'px';
  card.dataset.side = side;
  if (r && (side === 'up' || side === 'down'))
    card.style.setProperty('--ax', Math.max(18, Math.min(cw - 18, r.left + r.width / 2 - x)) + 'px');
}

function render() {
  const t = info(),
    list = steps(),
    st = t && t.steps ? t.steps[T.i] : null;
  if (!t || !st) return;
  const n = list.length,
    done = T.done[T.i] && !T.wasDone,
    dots = list.map((_, k) => `<i class="${k < T.i || T.done[k] ? 'on' : ''}${k === T.i ? ' now' : ''}"></i>`).join('');
  if (T.finished) {
    card.className = 'tg-card fin' + (PANEL ? ' compact' : '');
    card.innerHTML = `<div class="tg-k"><span>${esc(t.title)}</span><span>Done</span></div>
      <h5>Nice work.</h5><p>That’s ${esc(t.title.toLowerCase())}. Play it again, change it, or keep it.</p>
      <div class="tg-foot"><span class="sp"></span><button class="btn" data-tg="dl">${DL_IC}Download this project</button><button class="btn pri" data-tg="exit">${EXIT_IC}Exit practice</button></div>`;
    place();
    return;
  }
  const status = done
    ? '<div class="tg-ok"><i></i>Done</div>'
    : T.showing
      ? '<div class="tg-wait"><i></i>Watch…</div>'
      : `<div class="tg-wait"><i></i>Waiting for you…</div>`;
  const nextBtn = T.wasDone ? `<button class="btn" data-tg="next"${T.i === n - 1 ? ' hidden' : ''}>Next</button>` : '';
  card.className = 'tg-card' + (PANEL ? ' compact' : '');
  card.innerHTML = PANEL
    ? `<div class="tg-k"><span>Step ${T.i + 1} of ${n}</span></div><h5>${rich(st.do, 'tg-dm')}</h5>${status}
      <div class="tg-foot"><span class="sp"></span>${nextBtn}<button class="btn" data-tg="show"${T.showing ? ' disabled' : ''}>Show me</button></div>`
    : `<div class="tg-k"><span>${esc(t.title)}</span><span>Step ${T.i + 1} of ${n}</span></div><h5>${esc(st.title)}</h5>
      <p>${rich(st.do, 'tg-dm')}</p>${status}
      <div class="tg-foot"><span class="tg-dots" aria-hidden="true">${dots}</span>${
        T.i > 0 ? '<button class="btn" data-tg="back">Back</button>' : ''
      }${nextBtn}<button class="btn" data-tg="show"${T.showing ? ' disabled' : ''}>Show me</button></div>`;
  place();
}

function topBar(title: string) {
  const app = $('#app') as HTMLElement;
  app.classList.add('practice');
  const strip = document.createElement('div');
  strip.className = 'pr-strip';
  strip.innerHTML = `<span class="pr-chip"><i></i>Practice</span><span class="pr-name">${esc(title)}</span><span class="pr-safe">Nothing here is saved · your own project is safe</span>`;
  const brand = $('.top .brand') as HTMLElement;
  brand.after(strip);
  const ex = document.createElement('button');
  ex.className = 'btn pr-exit';
  ex.id = 'prExit';
  ex.innerHTML = EXIT_IC + 'Exit practice';
  ex.addEventListener('click', exitPractice);
  ($('.top') as HTMLElement).appendChild(ex);
}

/** Opens the tutorial's scene and starts its tour (app/boot, when the page is a practice editor). */
export async function startPractice() {
  const t = info(),
    sc = SCENES[TOUR];
  if (!t || !sc || !steps().length) {
    topBar('Practice');
    return;
  }
  await importSVG(sc.svg, true, sc.name);
  if (sc.setup) sc.setup();
  doc.name = sc.name;
  S.undo.length = 0;
  S.redo.length = 0;
  S.dirty = false;
  S.file = null;
  S.time = 0;
  S.sel = null;
  S.selSet = new Set();
  // a short timeline: a practice scene has a track or two, and the canvas gets the room
  setTlHeight(184); // saved, but only in this page's memory (core/batch-mode)
  renderAll();
  updateFileInfo();
  topBar(t.title);
  if (sc.menu) ($('#app') as HTMLElement).classList.add('pr-menu');
  spot = document.createElement('div');
  spot.className = 'tg-spot';
  spot.hidden = true;
  card = document.createElement('div');
  card.className = 'tg-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Guided tour: ' + t.title);
  card.setAttribute('aria-live', 'polite');
  document.body.append(spot, card);
  if (CLIP) document.body.classList.add('tg-clip');
  card.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tg]');
    if (!b) return;
    const a = b.dataset.tg;
    if (a === 'show') show();
    else if (a === 'back') back();
    else if (a === 'next') next();
    else if (a === 'exit') exitPractice();
    else if (a === 'dl') download();
  });
  window.addEventListener('message', e => {
    if (e.source !== window.parent || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.svgcinema !== 'tour-cmd') return;
    if (d.cmd === 'show') show();
    else if (d.cmd === 'back') back();
    else if (d.cmd === 'next') next();
    else if (d.cmd === 'exit') exitPractice();
    else if (d.cmd === 'download') download();
    else if (d.cmd === 'state') send();
  });
  addEventListener('resize', place);
  T.timer = setInterval(tick, 200);
  enter(0);
  // for tests and the clip recorder
  (window as any).cinTour = { state: tourState, show, next, back, exit: exitPractice, region, sample };
}
