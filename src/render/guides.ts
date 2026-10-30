// SVGcinema — render/guides
// Grid (behind or in front of the artwork), rulers along the top and left of the canvas, and guides:
// drag from a ruler to make one, drag it to move it, drag it back onto a ruler to remove it.
import type { XY } from '../model/types';
import { $, fmt } from '../core/constants';
import { CONTENT, OV, svgEl } from '../core/dom';
import { beginEdit } from '../core/history';
import { S, doc } from '../core/state';
import { VIEW } from '../core/view';
import { drawOverlay } from './overlay';
import { THEME_EVENT } from '../ui/theme';

const NS = 'http://www.w3.org/2000/svg',
  BIG = 100000,
  RW = 20; // ruler thickness, px

/* ---------- grid ---------- */

function gridPattern(id: string) {
  const g = VIEW.grid,
    u = 1 / (S.scale || 1),
    major = g * 10,
    minorOn = g * S.scale >= 5;
  let h = `<pattern id="${id}" width="${major}" height="${major}" patternUnits="userSpaceOnUse">`;
  if (minorOn)
    for (let i = 1; i < 10; i++)
      h += `<path d="M${i * g} 0V${major}M0 ${i * g}H${major}" stroke="var(--grid)" stroke-width="${u}"/>`;
  h += `<path d="M0 0V${major}M0 0H${major}" stroke="var(--grid-major)" stroke-width="${u}"/></pattern>`;
  return h;
}
function gridRect(id: string) {
  return `<rect x="${-BIG}" y="${-BIG}" width="${2 * BIG}" height="${2 * BIG}" fill="url(#${id})" pointer-events="none"/>`;
}
/** Back grid: between the background and the artwork. */
let lastBack = '';
export function drawBackGrid() {
  const g = document.getElementById('gridBack');
  if (!g) return;
  const key = VIEW.gridBack ? VIEW.grid + '@' + S.scale : '';
  if (key === lastBack && g.childNodes.length === (key ? 2 : 0)) return;
  lastBack = key;
  g.innerHTML = VIEW.gridBack ? `<defs>${gridPattern('klGridB')}</defs>${gridRect('klGridB')}` : '';
}

/* ---------- guides (drawn into the overlay) ---------- */

/** Called at the start of every overlay redraw: front grid, guides, rulers. */
export function drawGuides() {
  drawRulers();
  drawBackGrid();
  if (VIEW.gridFront) {
    const g = svgEl('g', { class: 'ov-grid' });
    g.innerHTML = `<defs>${gridPattern('klGridF')}</defs>${gridRect('klGridF')}`;
    OV.append(g);
  }
  if (!VIEW.guides || !doc || !doc.guides) return;
  (['x', 'y'] as const).forEach(ax =>
    doc.guides[ax].forEach((v, i) => {
      const a = ax === 'x' ? { x1: v, y1: -BIG, x2: v, y2: BIG } : { x1: -BIG, y1: v, x2: BIG, y2: v };
      OV.append(svgEl('line', { ...a, class: 'ov-guide-hit', 'data-guide': `${ax}:${i}` }));
      OV.append(svgEl('line', { ...a, class: 'ov-guide' }));
    }),
  );
}

/* ---------- rulers ---------- */

function ctx(id: string) {
  const c = document.getElementById(id) as HTMLCanvasElement;
  if (!c) return null;
  const r = c.getBoundingClientRect(),
    dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
  }
  const x = c.getContext('2d');
  if (!x) return null;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { x, r };
}
/** A round step for ruler numbers at this zoom (1, 2, 5 × 10ⁿ document units). */
function step() {
  const target = 80 / (S.scale || 1);
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  return [1, 2, 5, 10].map(m => m * p).find(s => s >= target) || p * 10;
}
export function drawRulers() {
  const on = VIEW.rulers;
  ['rulerX', 'rulerY', 'rulerC'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = !on;
  });
  if (!on || !CONTENT || !CONTENT.getScreenCTM) return;
  const M = CONTENT.getScreenCTM();
  if (!M) return;
  const css = getComputedStyle(document.documentElement),
    fg = css.getPropertyValue('--muted') || '#888',
    bg = css.getPropertyValue('--panel') || '#fff',
    line = css.getPropertyValue('--line') || '#ccc',
    st = step(),
    sub = st / 10;
  const X = ctx('rulerX'),
    Y = ctx('rulerY');
  if (X) {
    const { x: c, r } = X;
    c.clearRect(0, 0, r.width, r.height);
    c.fillStyle = bg;
    c.fillRect(0, 0, r.width, r.height);
    c.fillStyle = 'rgba(91,124,250,.10)';
    c.fillRect(M.e - r.left, 0, doc.w * M.a, r.height);
    c.strokeStyle = fg;
    c.fillStyle = fg;
    c.font = '9px ' + (css.getPropertyValue('--f-num') || 'monospace');
    c.lineWidth = 1;
    const d0 = (r.left - M.e) / M.a,
      d1 = (r.right - M.e) / M.a;
    c.beginPath();
    for (let v = Math.floor(d0 / sub) * sub; v <= d1; v += sub) {
      const px = Math.round(M.e + v * M.a - r.left) + 0.5,
        major = Math.abs(v / st - Math.round(v / st)) < 1e-6;
      c.moveTo(px, r.height);
      c.lineTo(px, r.height - (major ? r.height : 4));
      if (major) c.fillText(fmt(Math.round(v * 100) / 100), px + 3, 9);
    }
    c.stroke();
    c.strokeStyle = line;
    c.beginPath();
    c.moveTo(0, r.height - 0.5);
    c.lineTo(r.width, r.height - 0.5);
    c.stroke();
  }
  if (Y) {
    const { x: c, r } = Y;
    c.clearRect(0, 0, r.width, r.height);
    c.fillStyle = bg;
    c.fillRect(0, 0, r.width, r.height);
    c.fillStyle = 'rgba(91,124,250,.10)';
    c.fillRect(0, M.f - r.top, r.width, doc.h * M.d);
    c.strokeStyle = fg;
    c.fillStyle = fg;
    c.font = '9px ' + (css.getPropertyValue('--f-num') || 'monospace');
    const d0 = (r.top - M.f) / M.d,
      d1 = (r.bottom - M.f) / M.d;
    c.beginPath();
    for (let v = Math.floor(d0 / sub) * sub; v <= d1; v += sub) {
      const py = Math.round(M.f + v * M.d - r.top) + 0.5,
        major = Math.abs(v / st - Math.round(v / st)) < 1e-6;
      c.moveTo(r.width, py);
      c.lineTo(r.width - (major ? r.width : 4), py);
      if (major) {
        c.save();
        c.translate(9, py + 3);
        c.rotate(-Math.PI / 2);
        c.fillText(fmt(Math.round(v * 100) / 100), 0, 0);
        c.restore();
      }
    }
    c.stroke();
    c.strokeStyle = line;
    c.beginPath();
    c.moveTo(r.width - 0.5, 0);
    c.lineTo(r.width - 0.5, r.height);
    c.stroke();
  }
}

/* ---------- making and moving guides ---------- */

function toDoc(e: { clientX: number; clientY: number }): XY {
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(CONTENT.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}
function overRuler(e: PointerEvent, ax: 'x' | 'y') {
  const r = document.getElementById(ax === 'x' ? 'rulerY' : 'rulerX').getBoundingClientRect();
  return VIEW.rulers && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}
/** Drag guide `i` on axis `ax` (x = vertical line). A new guide is made when i < 0. */
export function guideDrag(ax: 'x' | 'y', i: number, e0: PointerEvent) {
  const ed = beginEdit();
  doc.guides = doc.guides || { x: [], y: [] };
  if (i < 0) {
    doc.guides[ax].push(Math.round(toDoc(e0)[ax]));
    i = doc.guides[ax].length - 1;
  }
  if (!VIEW.guides) VIEW.guides = true;
  const tip = $('#guideTip') as HTMLElement;
  const mv = (e: PointerEvent) => {
    const v = Math.round(toDoc(e)[ax]);
    doc.guides[ax][i] = v;
    const del = overRuler(e, ax);
    tip.hidden = false;
    tip.textContent = del ? 'Release to remove' : `${ax === 'x' ? 'X' : 'Y'} ${v}`;
    tip.style.left = e.clientX + 14 + 'px';
    tip.style.top = e.clientY + 14 + 'px';
    drawOverlay();
  };
  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    tip.hidden = true;
    if (overRuler(e, ax)) doc.guides[ax].splice(i, 1);
    ed.end();
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}
export function init(): void {
  // drag from a ruler: the top ruler makes a horizontal guide, the left one a vertical guide
  const start = (ax: 'x' | 'y') => (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    guideDrag(ax, -1, e);
  };
  $('#rulerX').addEventListener('pointerdown', start('y'));
  $('#rulerY').addEventListener('pointerdown', start('x'));
  window.addEventListener('resize', () => drawRulers());
  // the rulers paint with theme colors read from CSS: repaint them when the theme changes
  window.addEventListener(THEME_EVENT, () => drawRulers());
  void NS;
  void RW;
}
