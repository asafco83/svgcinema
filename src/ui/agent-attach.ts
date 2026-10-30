// SVGcinema — ui/agent-attach
// Attachments in the agent's prompt box: the paperclip (or drop files on the panel, or paste them),
// chips above the text (thumbnail, name, size, ×), a note when the model can't see pictures, and "@"
// references. Typing "@" opens a list of the attachments under the caret (↑↓, Enter or Tab, Esc);
// a picked reference is colored in the text and Backspace removes it whole. "@file.png" with no such
// file attached (its chip was removed) stays as plain, editable text in red, with a tip saying why.
// The colors come from a copy of the text drawn under the (transparent) textarea.
import { $ } from '../core/constants';
import { URLS } from '../core/state';
import { toast } from '../io/open';
import {
  ACCEPT,
  ATTACH,
  type Att,
  atQuery,
  attMeta,
  attachFiles,
  detach,
  isAttachable,
  matches,
  refAt,
  segments,
} from '../agent/attach';
import { canSee } from '../agent/settings';
import { CHAT, type Turn } from '../agent/chat';

const esc = (s: string) =>
  String(s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
const X =
  '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>';
export const CLIP =
  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 7.6L8.1 13a3.4 3.4 0 01-4.8-4.8l5.7-5.7a2.3 2.3 0 013.2 3.2L6.6 11.3a1.1 1.1 0 01-1.6-1.6l5-5"/></svg>';
const UP =
  '<svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10.5V3M4.8 6.2L8 3l3.2 3.2M3 10.5v1.8A1.2 1.2 0 004.2 13.5h7.6a1.2 1.2 0 001.2-1.2v-1.8"/></svg>';

const TA = () => $('#agText') as HTMLTextAreaElement;
const thumb = (id: string, name: string) =>
  URLS[id] ? `<img src="${esc(URLS[id])}" alt="" draggable="false">` : `<i>${esc(name.slice(0, 1).toUpperCase())}</i>`;

/** asset ids earlier messages refer to: removing a chip keeps those in Assets */
const sentIds = () => CHAT.turns.flatMap(t => (t.att || []).map(a => a.id));

/** what "@" lists, and where it is in the text (null: closed) */
const AT: { open: { from: number; q: string } | null; i: number; shut: number } = { open: null, i: 0, shut: -1 };

/* ---------- drawing ---------- */

/** The chips, and the note for a model that can't see. */
export function renderChips() {
  const box = $('#agAtt') as HTMLElement;
  if (!box) return;
  const L = ATTACH.list;
  box.hidden = !L.length;
  box.innerHTML = L.length
    ? `<div class="ag-att-l">${L.map(
        a =>
          `<span class="ag-att-i" data-att="${esc(a.id)}"><span class="th">${thumb(a.id, a.name)}</span><span class="ag-att-t"><b title="${esc(
            a.name,
          )}">${esc(a.name)}</b><small>${esc(attMeta(a))}</small></span><button class="x" data-attx="${esc(
            a.id,
          )}" aria-label="Remove ${esc(a.name)}" title="Remove">${X}</button></span>`,
      ).join('')}</div>${
        canSee()
          ? ''
          : '<p class="ag-att-note">This model can’t see pictures: it can place them, but not look at them.</p>'
      }`
    : '';
}

/** The colored copy of the text under the textarea (and, for placing the "@" list, a mark at `mark`). */
export function renderHL(mark = -1) {
  const hl = $('#agHL') as HTMLElement,
    ta = TA();
  if (!hl || !ta) return;
  const text = ta.value;
  let h = '',
    i = 0;
  const put = (s: string, cls: string, from: number) => {
    const wrap = (x: string) => (cls ? `<span class="${cls}">${esc(x)}</span>` : esc(x));
    if (mark >= from && mark <= from + s.length && mark !== -2) {
      const k = mark - from;
      h += wrap(s.slice(0, k)) + '<i class="ag-mark"></i>' + wrap(s.slice(k));
      mark = -2;
    } else h += wrap(s);
  };
  for (const g of segments(text, ATTACH.list)) {
    put(g.s, g.t === 'ref' ? 'ag-ref' : g.t === 'bad' ? 'ag-ref-x' : '', i);
    i += g.s.length;
  }
  if (mark >= 0) h += '<i class="ag-mark"></i>';
  // a last empty line still takes its height
  hl.innerHTML = h + '​';
  hl.scrollTop = ta.scrollTop;
}

/** The user's message in the chat: thumbnails of what was attached, then the text with its references. */
export function userHTML(t: Turn) {
  const att = (t.att || []) as Att[];
  const pics = att.length
    ? `<div class="ag-user-att">${att
        .map(a => `<span class="th" title="${esc(a.name)}">${thumb(a.id, a.name)}</span>`)
        .join('')}</div>`
    : '';
  if (!t.user) return pics;
  const body = segments(t.user, att)
    .map(g => (g.t === 'ref' ? `<span class="ag-ref">${esc(g.s)}</span>` : esc(g.s)))
    .join('');
  return `${pics}<div class="ag-user" dir="auto">${body}</div>`;
}

/* ---------- the "@" list ---------- */

function menu() {
  let m = document.getElementById('agAtMenu');
  if (!m) {
    m = document.createElement('div');
    m.id = 'agAtMenu';
    m.className = 'ag-at';
    m.setAttribute('role', 'listbox');
    m.setAttribute('aria-label', 'Attachments');
    m.hidden = true;
    document.body.appendChild(m);
    m.addEventListener('pointerdown', e => {
      const o = (e.target as Element).closest('[data-pick]') as HTMLElement | null;
      e.preventDefault();
      if (o) pick(o.dataset.pick);
    });
  }
  return m;
}
function closeAt() {
  AT.open = null;
  const m = document.getElementById('agAtMenu');
  if (m) m.hidden = true;
  TA().removeAttribute('aria-activedescendant');
}
/** Open, follow or close the list as the caret moves. */
function syncAt() {
  const ta = TA(),
    q =
      document.activeElement === ta && ta.selectionStart === ta.selectionEnd
        ? atQuery(ta.value, ta.selectionStart)
        : null,
    list = q ? matches(q.q, ATTACH.list) : [];
  if (!q || !list.length || q.from === AT.shut) {
    if (!q) AT.shut = -1;
    return closeAt();
  }
  if (!AT.open || AT.open.from !== q.from || AT.open.q !== q.q) AT.i = 0;
  AT.open = q;
  AT.i = Math.min(AT.i, list.length - 1);
  const m = menu();
  m.innerHTML = `<h6>Attachments</h6>${list
    .map(
      (a, i) =>
        `<div class="ag-at-o${i === AT.i ? ' on' : ''}" role="option" id="agAtO${i}" aria-selected="${
          i === AT.i
        }" data-pick="${esc(a.id)}"><span class="th">${thumb(a.id, a.name)}</span><b>${esc(a.name)}</b><small>${esc(
          a.kind === 'svg' ? 'vector' : attMeta(a),
        )}</small></div>`,
    )
    .join('')}<p class="ag-at-f">↑↓ choose · Enter insert · Esc close</p>`;
  m.hidden = false;
  ta.setAttribute('aria-activedescendant', 'agAtO' + AT.i);
  // above the caret's line, starting at the "@"
  renderHL(q.from);
  const k = document.querySelector('#agHL .ag-mark') as HTMLElement | null,
    r = k ? k.getBoundingClientRect() : ta.getBoundingClientRect(),
    host = ($('#agent') as HTMLElement).getBoundingClientRect(),
    w = m.offsetWidth || 228;
  m.style.left = Math.round(Math.max(host.left + 8, Math.min(r.left - 12, host.right - w - 8))) + 'px';
  // above the text (not over the lines already written), from the "@" across
  const top = Math.min(r.top, ta.getBoundingClientRect().top + 4);
  m.style.top = Math.round(Math.max(8, top - m.offsetHeight - 2)) + 'px';
  renderHL();
}
function pick(id: string) {
  const ta = TA(),
    a = ATTACH.list.find(x => x.id === id);
  if (!a || !AT.open) return;
  const { from } = AT.open,
    to = ta.selectionStart,
    after = ta.value.slice(to),
    ins = '@' + a.name + (/^\s/.test(after) ? '' : ' ');
  ta.value = ta.value.slice(0, from) + ins + after;
  const c = from + ins.length;
  ta.setSelectionRange(c, c);
  closeAt();
  ta.focus();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ---------- the tip on a red reference ---------- */

function tip(e: MouseEvent) {
  let t = document.getElementById('agRefTip');
  const bad = [...document.querySelectorAll<HTMLElement>('#agHL .ag-ref-x')].find(s =>
    [...s.getClientRects()].some(
      r => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom,
    ),
  );
  if (!bad) {
    if (t) t.hidden = true;
    return;
  }
  if (!t) {
    t = document.createElement('div');
    t.id = 'agRefTip';
    t.className = 'ag-tip';
    t.setAttribute('role', 'tooltip');
    document.body.appendChild(t);
  }
  t.textContent = `${bad.textContent.slice(1)} isn’t attached any more: attach it again, or edit the text`;
  t.hidden = false;
  const r = bad.getClientRects()[0];
  t.style.left = Math.round(Math.max(8, Math.min(r.left - 4, innerWidth - t.offsetWidth - 8))) + 'px';
  t.style.top = Math.round(r.top - t.offsetHeight - 6) + 'px';
}

/* ---------- adding and taking ---------- */

export async function addFiles(files: File[]) {
  const ok = files.filter(isAttachable);
  if (!files.length) return;
  if (!ok.length) return toast('Attach PNG, JPG, WebP, GIF or SVG files.');
  const r = await attachFiles(files);
  if (r.errors.length) toast(r.errors[0]);
  renderChips();
  renderHL();
  changed();
}
/** The message's attachments, taken off the composer as it is sent. */
export function takeAttachments(): Att[] {
  const l = ATTACH.list;
  ATTACH.list = [];
  closeAt();
  renderChips();
  renderHL();
  return l;
}
/** A new project: nothing is attached. */
export function resetAttachments() {
  ATTACH.list = [];
  closeAt();
  renderChips();
  renderHL();
}

let changed: () => void = () => {};

/** Hook the composer up. `onChange`: the text or the attachments changed (Send enabled or not). */
export function initAttach(onChange: () => void) {
  changed = onChange;
  const ta = TA(),
    host = $('#agent') as HTMLElement,
    file = $('#agAttFile') as HTMLInputElement;
  file.accept = ACCEPT;
  $('#agClip').addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = [...(file.files || [])];
    file.value = '';
    addFiles(f);
  });
  $('#agAtt').addEventListener('click', (e: MouseEvent) => {
    const x = (e.target as Element).closest('[data-attx]') as HTMLElement | null;
    if (!x) return;
    detach(x.dataset.attx, sentIds());
    renderChips();
    renderHL();
    changed();
    ta.focus();
  });
  // before the panel's Enter-sends handler: the list takes the keys while it is open
  ta.addEventListener('keydown', e => {
    if (AT.open && !e.isComposing) {
      const n = matches(AT.open.q, ATTACH.list).length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        AT.i = (AT.i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        return syncAt();
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();
        return pick(matches(AT.open.q, ATTACH.list)[AT.i].id);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        AT.shut = AT.open.from;
        return closeAt();
      }
    }
    // a reference goes as one piece
    if ((e.key === 'Backspace' || e.key === 'Delete') && ta.selectionStart === ta.selectionEnd) {
      const r = refAt(ta.value, ta.selectionStart, ATTACH.list, e.key === 'Backspace' ? 'end' : 'start');
      if (r) {
        e.preventDefault();
        ta.setRangeText('', r.from, r.to, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });
  ta.addEventListener('input', () => {
    renderHL();
    syncAt();
  });
  ta.addEventListener('scroll', () => (($('#agHL') as HTMLElement).scrollTop = ta.scrollTop));
  ['click', 'keyup'].forEach(ev =>
    ta.addEventListener(ev, (e: Event) => {
      const k = (e as KeyboardEvent).key;
      if (ev === 'keyup' && !/^Arrow(Left|Right)$|^Home$|^End$/.test(k || '')) return;
      syncAt();
    }),
  );
  ta.addEventListener('blur', () => setTimeout(closeAt, 0));
  ta.addEventListener('mousemove', tip);
  ta.addEventListener('mouseleave', () => {
    const t = document.getElementById('agRefTip');
    if (t) t.hidden = true;
  });
  ta.addEventListener('paste', e => {
    const f = [...((e.clipboardData && e.clipboardData.files) || [])].filter(isAttachable);
    if (!f.length) return;
    e.preventDefault();
    addFiles(f);
  });
  // drop files anywhere on the panel (the assistant's own drop card keeps its drops)
  let over: HTMLElement | null = null;
  const show = (on: boolean) => {
    if (on && !over) {
      over = document.createElement('div');
      over.className = 'ag-dropov';
      over.id = 'agDropOver';
      over.innerHTML = `${UP}Drop to attach to your message<small>PNG, JPG, WebP, GIF or SVG · up to 4</small>`;
      document.body.appendChild(over);
    }
    if (!over) return;
    over.hidden = !on;
    if (on) {
      const r = host.getBoundingClientRect(),
        top = (($('#agHead') as HTMLElement).getBoundingClientRect().bottom || r.top) + 8;
      Object.assign(over.style, {
        left: r.left + 8 + 'px',
        top: top + 'px',
        width: r.width - 16 + 'px',
        height: r.bottom - 8 - top + 'px',
      });
    }
  };
  const can = (e: DragEvent) =>
    !!e.dataTransfer &&
    [...e.dataTransfer.types].includes('Files') &&
    !($('#agComp') as HTMLElement).hidden &&
    !(e.target as HTMLElement).closest('#agDrop');
  host.addEventListener('dragover', e => {
    if (!can(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    show(true);
  });
  host.addEventListener('dragleave', e => {
    const to = e.relatedTarget as Node | null;
    if (!to || !host.contains(to)) show(false);
  });
  host.addEventListener('drop', e => {
    show(false);
    if (!can(e)) return;
    e.preventDefault();
    e.stopPropagation();
    addFiles([...e.dataTransfer!.files]);
  });
  addEventListener('dragend', () => show(false));
  renderChips();
  renderHL();
}
