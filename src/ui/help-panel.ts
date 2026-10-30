// SVGcinema — ui/help-panel
// Help & tutorials in the editor (☰ › Help › Help & tutorials, Shift F1): a panel docked on the right at
// full height, where the Agent panel docks (only one of the two is open at a time). It has the same pages
// as the website's help (help/content.json): a hub (search, Start here, the topics by group) and a page per
// topic (what it does, the steps with their clips, keys, related topics, ↗ the page on the website).
//
// "Start guided tour" opens a practice editor (help/practice: index.html?tour=<id>&panel=1) in a frame
// over the editor, leaving this panel where it is. The practice editor has the tutorial's own scene and
// keeps nothing; your project stays open underneath, untouched, and comes back on Exit. While the tour
// runs, this panel lists its steps (done ones ticked, the current one lit, Show me) and the frame tells it
// how far the tour is (postMessage, same origin).
import { track } from '../core/analytics';
import { $, esc } from '../core/constants';
import { doc } from '../core/state';
import { workAreaResized } from '../tools/hand';
import { GROUPS, READY, type HelpTopic, keyHTML, rich, topic } from '../help/content';
import { isAgentOpen, toggleAgent } from './agent-panel';
import { currentTheme, THEME_EVENT } from './theme';
import { PRACTICE } from '../core/batch-mode';

const OPEN_KEY = 'svgcinema:help.open';
/** where the website is: beside the editor when it runs from the site's editor/ folder */
const SITE = /\/editor\/(index\.html)?$/.test(location.pathname) ? '../' : null;

const ST = {
  open: false,
  view: 'hub' as 'hub' | 'topic',
  id: '',
  q: '',
  /** the guided tour running in the practice editor, as it last told us */
  tour: null as null | { id: string; i: number; n: number; done: boolean[]; finished: boolean; showing: boolean },
};
let frame: HTMLIFrameElement | null = null;
let searchT: ReturnType<typeof setTimeout> | undefined;

const svg = (d: string, s = 16, w = 1.4) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  book: svg(
    '<path d="M2.5 3.2c2-.9 3.9-.9 5.5.4 1.6-1.3 3.5-1.3 5.5-.4v9.6c-2-.9-3.9-.9-5.5.4-1.6-1.3-3.5-1.3-5.5-.4z"/><path d="M8 3.6v9.6"/>',
    15,
  ),
  ext: svg('<path d="M9 3h4v4M13 3L7.5 8.5M11.5 9.5V13H3V4.5h3.5"/>', 14),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>', 12, 1.5),
  back: svg('<path d="M10 3.5L5.5 8l4.5 4.5"/>', 14, 1.6),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>', 14, 1.5),
  play: '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M2 1.2v7.6l6.5-3.8z"/></svg>',
  exit: svg('<path d="M6 3H3v10h3M10.5 5L13.5 8l-3 3M13.5 8H6"/>', 13, 1.5),
  check: svg('<path d="M3.5 8.3l3 3 6-6.6"/>', 12, 1.8),
};
const host = () => $('#help') as HTMLElement;
const app = () => $('#app') as HTMLElement;

export const isHelpOpen = () => ST.open;
export const isPracticing = () => !!frame;

/** Open or close the panel (it takes the Agent panel's place). */
export function toggleHelp(open = !ST.open) {
  if (PRACTICE) return; // a practice editor is the tour itself: its help is the panel beside it
  if (!open && frame) closePractice();
  ST.open = open;
  if (open && isAgentOpen()) toggleAgent(false);
  host().hidden = !open;
  app().classList.toggle('help-on', open);
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch (_) {
    /* remembered for this visit only */
  }
  if (open) render();
  workAreaResized();
}
/** Open the panel on a topic (the hub when there is no such topic). */
export function openHelp(id?: string) {
  if (id && topic(id)) {
    ST.view = 'topic';
    ST.id = id;
  }
  if (!ST.open) toggleHelp(true);
  else render();
}

/* ---------- rendering ---------- */

const clipName = (id: string, n: number) => `help/${id}-${n}${currentTheme() === 'dark' ? '-dark' : ''}`;
function clip(id: string, n: number, alt: string) {
  const f = clipName(id, n);
  return `<video class="hp-clip" poster="${f}.webp" muted loop playsinline preload="none" aria-label="${esc(alt)}"><source src="${f}.mp4" type="video/mp4"></video>`;
}
function head() {
  const site = SITE && ST.view === 'topic' ? `${SITE}help/${ST.id}/` : SITE ? `${SITE}help/` : '';
  const back =
    ST.view === 'topic' && !ST.tour
      ? `<button class="ag-ib" data-hp="hub" aria-label="All help" title="All help">${I.back}</button>`
      : `<span class="hp-logo">${I.book}</span>`;
  return `${back}<span class="ag-title">Help</span><span class="sp"></span>${
    site
      ? `<a class="ag-ib" href="${site}" target="_blank" rel="noopener" aria-label="Open on the website" title="Open on the website">${I.ext}</a>`
      : ''
  }<button class="ag-ib" data-hp="close" aria-label="Close help (Shift+F1)" title="Close (Shift+F1)">${I.close}</button>`;
}
function tourMeta(t: HelpTopic) {
  return t.tour && t.steps ? `${t.steps.length} steps · ${t.minutes || 3} min` : '';
}
const plain = (h: string) => h.replace(/<[^>]+>/g, '').replace(/\{◆\}/g, '◆');
function matches(t: HelpTopic, q: string) {
  const s = [t.title, t.intro || '', ...(t.steps || []).map(x => x.title + ' ' + plain(x.text))]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(w => s.includes(w));
}
function hub() {
  const first = READY.find(t => t.group === 'start' && t.tour);
  let h = `<label class="hp-search">${I.search}<input id="hpQ" type="search" placeholder="Search help" aria-label="Search help" value="${esc(ST.q)}"></label>`;
  if (ST.q.trim()) {
    const hits = READY.filter(t => matches(t, ST.q));
    h += hits.length
      ? `<div class="hp-grp">${hits.map(row).join('')}</div>`
      : `<p class="hp-muted">Nothing found for “${esc(ST.q)}”.</p>`;
    return h;
  }
  if (first)
    h += `<div class="hp-start"><small>START HERE · GUIDED TOUR · ${first.minutes || 5} MIN</small><b>${esc(first.title)}</b>
      <span class="hp-muted">${esc(first.intro || '')}</span>
      <button class="btn pri hp-go" data-tour="${first.id}">${I.play}Start the tour</button></div>`;
  for (const g of GROUPS) {
    const ts = READY.filter(t => t.group === g.id);
    if (!ts.length) continue;
    h += `<div class="hp-grp"><h4>${esc(g.title)}</h4>${ts.map(row).join('')}</div>`;
  }
  return h;
}
function row(t: HelpTopic) {
  return `<button class="hp-row" data-topic="${t.id}"><span>${esc(t.title)}</span>${
    t.tour ? '<i class="hp-tag">Tour</i>' : ''
  }</button>`;
}
function topicView(t: HelpTopic) {
  const g = GROUPS.find(x => x.id === t.group);
  let h = `<div><div class="hp-crumb">${esc(g ? g.title : '')}</div><h2 class="hp-h">${esc(t.title)}</h2></div>
    <p class="hp-muted hp-intro">${rich(t.intro || '')}</p>`;
  if (t.tour)
    h += `<div class="hp-tourrow"><button class="btn pri hp-go" data-tour="${t.id}">${I.play}Start guided tour</button><span class="hp-muted">${tourMeta(t)}</span></div>`;
  h += `<ol class="hp-steps">${(t.steps || [])
    .map(
      (s, i) =>
        `<li><div><b>${esc(s.title)}.</b> ${rich(s.text)}${s.clip === false ? '' : clip(t.id, i + 1, s.title)}</div></li>`,
    )
    .join('')}</ol>`;
  if (t.note) h += `<div class="hp-note"><b>Good to know.</b> ${rich(t.note)}</div>`;
  if (t.keys && t.keys.length)
    h += `<div class="hp-keys"><b>Keys</b>${t.keys
      .map(([k, what]) => `<div class="hp-key"><span>${keyHTML(k)}</span><span>${esc(what)}</span></div>`)
      .join('')}</div>`;
  const rel = (t.related || []).map(id => topic(id)).filter(Boolean) as HelpTopic[];
  if (rel.length)
    h += `<div class="hp-rel"><b>Related</b>${rel
      .map(r => `<button class="hp-link" data-topic="${r.id}">${esc(r.title)} →</button>`)
      .join('')}</div>`;
  return h;
}
function tourView(t: HelpTopic) {
  const tr = ST.tour!,
    n = (t.steps || []).length,
    pct = tr.finished ? 100 : Math.round((tr.done.filter(Boolean).length / Math.max(1, n)) * 100);
  const steps = (t.steps || [])
    .map((s, i) => {
      const done = tr.done[i] || i < tr.i || tr.finished,
        now = i === tr.i && !tr.finished;
      return `<li class="${done ? 'done' : ''}${now ? ' now' : ''}"><i class="hp-n" aria-hidden="true">${done && !now ? I.check : i + 1}</i><div><b>${esc(s.title)}.</b> ${rich(
        now ? s.text : s.do,
      )}${
        now
          ? `<div class="hp-now"><button class="btn" data-cmd="show"${tr.showing ? ' disabled' : ''}>Show me</button>${
              tr.i > 0 ? '<button class="btn" data-cmd="back">Back</button>' : ''
            }</div>`
          : ''
      }</div></li>`;
    })
    .join('');
  return `<div><div class="hp-crumb">Guided tour</div><h2 class="hp-h">${esc(t.title)}</h2></div>
    <div class="hp-prog"><span>${tr.finished ? '<b>Done</b>' : `<b>Step ${tr.i + 1}</b> of ${n}`}</span><span class="hp-bar"><i style="width:${pct}%"></i></span></div>
    <ol class="hp-steps hp-tour">${steps}</ol>
    ${
      tr.finished
        ? `<div class="hp-start"><b>Nice work.</b><span class="hp-muted">Play it again, change it, or keep it.</span><button class="btn" data-cmd="download">Download this project</button></div>`
        : ''
    }
    <div class="hp-safe"><b>Your project is waiting.</b> “${esc(doc.name)}” is open underneath, just as you left it. Exit the practice to go back to it.</div>
    <button class="btn hp-exit" data-cmd="exit">${I.exit}Exit practice</button>`;
}

export function render() {
  if (!ST.open) return;
  const t = ST.view === 'topic' ? topic(ST.id) : null;
  if (ST.view === 'topic' && !t) ST.view = 'hub';
  const focus = document.activeElement && (document.activeElement as HTMLElement).id;
  $('#hpHead').innerHTML = head();
  const body = $('#hpBody') as HTMLElement;
  body.innerHTML = ST.tour && t ? tourView(t) : t ? topicView(t) : hub();
  if (focus === 'hpQ') {
    const q = $('#hpQ') as HTMLInputElement;
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
  watchClips();
}

/* the clips play while they are in view (and not for readers who ask for less motion) */
let io: IntersectionObserver | null = null;
function watchClips() {
  if (io) io.disconnect();
  const vids = [...host().querySelectorAll<HTMLVideoElement>('video.hp-clip')];
  if (!vids.length || typeof IntersectionObserver === 'undefined') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  io = new IntersectionObserver(
    es =>
      es.forEach(e => {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting) v.play().catch(() => {});
        else v.pause();
      }),
    { root: $('#hpBody') as HTMLElement, threshold: 0.4 },
  );
  vids.forEach(v => io!.observe(v));
}

/* ---------- the practice editor ---------- */

/** Start a guided tour: a practice editor in a frame over the editor; this panel lists its steps. */
export function startTour(id: string) {
  const t = topic(id);
  if (!t || !t.tour) return;
  closePractice();
  ST.view = 'topic';
  ST.id = id;
  ST.tour = { id, i: 0, n: (t.steps || []).length, done: [], finished: false, showing: false };
  track('tour_start', { topic: id, where: 'editor' });
  frame = document.createElement('iframe');
  frame.className = 'prac-frame';
  frame.title = 'Practice: ' + t.title;
  frame.src = `${location.pathname}?tour=${encodeURIComponent(id)}&panel=1`;
  document.body.appendChild(frame);
  app().classList.add('practicing');
  if (!ST.open) toggleHelp(true);
  else render();
  frame.addEventListener('load', () => frame && frame.contentWindow && frame.contentWindow.focus());
}
/** Leave the practice editor: the frame goes, and with it everything done there. */
export function closePractice() {
  if (frame) {
    frame.remove();
    frame = null;
  }
  app().classList.remove('practicing');
  if (ST.tour) {
    if (!ST.tour.finished) track('tour_exit', { topic: ST.tour.id, step: ST.tour.i + 1, where: 'editor' });
    ST.tour = null;
    render();
  }
}
function cmd(c: string) {
  if (c === 'exit') return closePractice();
  if (frame && frame.contentWindow) frame.contentWindow.postMessage({ svgcinema: 'tour-cmd', cmd: c }, location.origin);
}

/* ---------- events ---------- */

function onClick(e: MouseEvent) {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-hp],[data-topic],[data-tour],[data-cmd]');
  if (!b) return;
  if (b.dataset.hp === 'close') toggleHelp(false);
  else if (b.dataset.hp === 'hub') {
    ST.view = 'hub';
    render();
  } else if (b.dataset.topic) {
    ST.view = 'topic';
    ST.id = b.dataset.topic;
    track('help_topic', { topic: ST.id });
    render();
    ($('#hpBody') as HTMLElement).scrollTop = 0;
  } else if (b.dataset.tour) startTour(b.dataset.tour);
  else if (b.dataset.cmd) cmd(b.dataset.cmd);
}

export function init(): void {
  const h = host();
  h.innerHTML = `<div class="ag-head" id="hpHead"></div><div class="hp-body" id="hpBody"></div>`;
  h.addEventListener('click', onClick);
  h.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'hpQ') {
      ST.q = t.value;
      render();
      // what people look for in help (help words only), once they stop typing
      clearTimeout(searchT);
      searchT = setTimeout(
        () => ST.q.trim().length > 1 && track('help_search', { term: ST.q.trim().toLowerCase().slice(0, 40) }),
        1200,
      );
    }
  });
  window.addEventListener('message', e => {
    if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return;
    const d = e.data;
    if (!d) return;
    if (d.svgcinema === 'tour-exit') closePractice();
    else if (d.svgcinema === 'tour' && ST.tour && d.id === ST.tour.id) {
      if (d.finished && !ST.tour.finished) track('tour_complete', { topic: d.id, where: 'editor' });
      ST.tour = { id: d.id, i: d.i, n: d.n, done: d.done || [], finished: !!d.finished, showing: !!d.showing };
      render();
    }
  });
  // while a practice editor is open, the keys belong to it: nothing reaches the project underneath
  // (typing in this panel's own fields still works)
  window.addEventListener(
    'keydown',
    e => {
      if (!frame) return;
      const t = e.target as HTMLElement;
      if (t && t.closest && t.closest('#help') && t.matches('input, textarea')) return;
      if (e.key === 'F1' && e.shiftKey) return; // closes the panel (and the practice)
      e.stopImmediatePropagation();
    },
    true,
  );
  window.addEventListener(THEME_EVENT, () => ST.open && render());
  document.addEventListener('svgcinema:agent-open', () => ST.open && toggleHelp(false));
  try {
    if (localStorage.getItem(OPEN_KEY) === '1') toggleHelp(true);
  } catch (_) {
    /* starts closed */
  }
}
