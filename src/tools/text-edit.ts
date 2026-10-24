// SVGcinema — tools/text-edit
// Typing text straight on the canvas. The SVG text stays visible and is redrawn on every keystroke, so
// every style shows exactly as it will look (fills, strokes, opacity, filters, fonts). Over it lies a
// <textarea> laid out the same way (font, size, spacing, alignment, transform) whose own letters are
// invisible: it only supplies the caret and the selection. Esc, Ctrl+Enter or clicking away ends it.
// While editing, the box shows side handles that set its width (and turn on Keep width).
import type { Layer } from '../model/types';
import { H, byId } from '../core/constants';
import { beginEdit } from '../core/history';
import { S, layerById } from '../core/state';
import { familyCSS } from '../render/fonts';
import { anchorX, textDir, textLines, textWidth, visualAnchor } from '../render/text-layout';
import { frame, renderStage } from '../render/stage';
import { spellOn } from '../core/spell';

let ta: HTMLTextAreaElement | null = null,
  edit: { end(o?: any): void } | null = null,
  editing: string | null = null;

export function textEditing() {
  return editing;
}
/** The edit box in the text's own space. */
export function editBox(l: Layer) {
  const L = layout(l);
  return { x: L.left, y: L.top, w: L.w, h: L.h };
}
function layout(l: Layer) {
  const G = l.geo,
    size = G.size || 16,
    lh = (G.lh || 1.2) * size,
    lines = textLines(G),
    w = G.wrap && G.ww > 0 ? G.ww : Math.max(size * 0.6, ...lines.map(s => textWidth(s, G))) + size * 0.4,
    ax = anchorX(G),
    va = visualAnchor(G),
    left = G.wrap && G.ww > 0 ? G.x : va === 'middle' ? ax - w / 2 : va === 'end' ? ax - w : ax,
    // the first baseline sits about 0.8em below the top of a line box
    top = G.y - size * 0.8 - (lh - size) / 2;
  return { size, lh, w, left, top, h: Math.max(1, lines.length) * lh };
}
function place(l: Layer) {
  const el = byId('e-' + l.id + '-s') as unknown as SVGGraphicsElement;
  if (!ta || !el) return;
  const G = l.geo,
    m = el.getScreenCTM(),
    L = layout(l),
    c = H.comp(l, S.time);
  Object.assign(ta.style, {
    transform: `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}) translate(${L.left}px,${L.top}px)`,
    width: L.w + 'px',
    height: L.h + 'px',
    font: `${G.italic ? 'italic ' : ''}${G.weight || 400} ${L.size}px/${L.lh}px ${familyCSS(G.family)}`,
    letterSpacing: (G.ls || 0) + 'px',
    textDecoration: G.deco || 'none',
    textAlign: { start: 'left', middle: 'center', end: 'right' }[visualAnchor(G)],
    direction: textDir(G),
    textTransform:
      ({ upper: 'uppercase', lower: 'lowercase', title: 'capitalize' } as Record<string, string>)[G.tcase] || 'none',
    whiteSpace: G.wrap && G.ww > 0 ? 'pre-wrap' : 'pre',
    color: 'transparent',
    caretColor: typeof c.fill === 'string' && c.fill !== 'none' && !/^url/.test(c.fill) ? c.fill : '#5b7cfa',
  });
}
/** Start typing into a text layer on the canvas. `selectAll` selects the current text (new layers). */
export function startTextEdit(l: Layer, selectAll?: boolean) {
  if (!l || l.type !== 'text') return;
  if (editing) endTextEdit();
  editing = l.id;
  edit = beginEdit();
  ta = document.createElement('textarea');
  ta.className = 'cin-tedit';
  // the browser's own spell check: it underlines misspelt words in the language of the person's browser
  ta.spellcheck = spellOn();
  ta.setAttribute('aria-label', 'Text');
  ta.value = String(l.geo.text || '');
  document.body.appendChild(ta);
  renderStage();
  frame();
  place(l);
  ta.focus();
  if (selectAll) ta.select();
  else ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('input', () => {
    const L = layerById(editing);
    if (!L) return endTextEdit();
    L.geo.text = ta.value;
    renderStage();
    frame();
    place(L);
    const it = document.getElementById('g-text') as HTMLTextAreaElement;
    if (it) it.value = ta.value;
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      endTextEdit();
    }
    e.stopPropagation();
  });
  ta.addEventListener('blur', () => setTimeout(() => editing && document.activeElement !== ta && endTextEdit(), 0));
}
export function endTextEdit() {
  if (!editing) return;
  const l = layerById(editing);
  editing = null;
  if (ta) ta.remove();
  ta = null;
  if (l && !String(l.geo.text || '').trim()) l.geo.text = 'Text';
  const e = edit;
  edit = null;
  if (e) e.end({ insp: true });
  else renderStage();
}
/** Keep the editor on top of the text when the view moves (zoom, pan, playhead). */
export function followTextEdit() {
  const l = editing && layerById(editing);
  if (l) place(l);
}
