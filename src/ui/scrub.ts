// SVGcinema — ui/scrub
// Drag the label at the left of any number field (the "X" in "X 162") left or right to change its
// value: one unit per pixel (Shift ×10, Alt ×0.1). In a number field, ↑ / ↓ step the value the same
// way (Shift ×10, Alt ×0.1), live; holding the key down is one undo step. The inspector scrubs its own animatable fields
// live (inspector.ts, `data-scrub`); this covers every other number field (shape geometry, text,
// document, timeline length, colour stops, export…) by typing into the field and sending the same
// input/change events typing would, so each field keeps its own rules. A whole drag is one undo step.
import { S, doc } from '../core/state';
import { clock, fmt, parseClock } from '../core/constants';

/** the length field shows a clock time ("0:03.00"): read and write it as one */
const readV = (inp: HTMLInputElement) => (inp.id === 'tDur' ? parseClock(inp.value) : parseFloat(inp.value));
const writeV = (inp: HTMLInputElement, v: number) => (inp.id === 'tDur' ? clock(Math.max(0.1, v)) : fmt(v));
/** pixels-to-value steps for fields whose unit is small */
const STEP: Record<string, number> = {
  'g-lh': 0.01,
  'g-ls': 0.1,
  tDur: 0.05,
  'd-dur': 0.05,
  'kf-time': 0.01,
  'ez-0': 0.01,
  'ez-1': 0.01,
  'ez-2': 0.01,
  'ez-3': 0.01,
  xSpeed: 0.05,
};

/** the label a scrub starts from, and its field */
export function scrubTarget(t: EventTarget | null): { lab: HTMLElement; inp: HTMLInputElement } | null {
  const lab = t && (t as any).closest ? ((t as Element).closest('.nf > span') as HTMLElement) : null;
  if (!lab) return null;
  const inp = lab.parentElement.querySelector('input') as HTMLInputElement | null;
  if (!inp || inp.disabled || inp.readOnly || inp.type === 'range' || inp.type === 'checkbox') return null;
  // only number fields: they ask for a numeric keyboard, or hold a number
  const mode = inp.getAttribute('inputmode');
  if (mode !== 'decimal' && mode !== 'numeric' && !isFinite(parseFloat(inp.value))) return null;
  return { lab, inp };
}
/** finds the field again after a panel re-rendered it */
function locator(inp: HTMLInputElement): () => HTMLInputElement | null {
  if (inp.id) return () => document.getElementById(inp.id) as HTMLInputElement | null;
  const sel =
    'input' +
    [...inp.attributes]
      .filter(a => a.name.startsWith('data-'))
      .map(a => `[${a.name}="${CSS.escape(a.value)}"]`)
      .join('');
  return () => (inp.isConnected ? inp : (document.querySelector(sel) as HTMLInputElement | null));
}
/** what ↑ / ↓ add in fields whose unit is small (seconds, line height, easing handles); 1 elsewhere */
const KEY_STEP: Record<string, number> = {
  'g-lh': 0.05,
  'g-ls': 0.1,
  tDur: 0.1,
  'd-dur': 0.1,
  'kf-time': 0.05,
  'ez-0': 0.05,
  'ez-1': 0.05,
  'ez-2': 0.05,
  'ez-3': 0.05,
  xSpeed: 0.1,
};
/** Is this a number field (asks for a numeric keyboard, and isn't a native number, range or checkbox)? */
function numberField(t: EventTarget | null): HTMLInputElement | null {
  const inp = t as HTMLInputElement | null;
  if (!inp || inp.tagName !== 'INPUT' || inp.disabled || inp.readOnly) return null;
  if (inp.type === 'number' || inp.type === 'range' || inp.type === 'checkbox') return null;
  const mode = inp.getAttribute('inputmode');
  return mode === 'decimal' || mode === 'numeric' ? inp : null;
}
export function scrubStep(lab: HTMLElement, inp: HTMLInputElement) {
  return +lab.dataset.scrubStep || STEP[inp.id] || 1;
}

/** ↑ / ↓ in a number field. Runs after the field's own handlers (a field that uses the arrows itself
 *  prevents the default). A run of presses while the key is held is one undo step. */
function initArrows() {
  let run: { el: HTMLInputElement; undo0: string[]; snap0: string } | null = null,
    keep: { refocus: () => void; until: number } | null = null;
  const end = () => {
    if (!run) return;
    const r = run;
    run = null;
    if (doc && JSON.stringify(doc) !== r.snap0) {
      S.undo = r.undo0;
      S.undo.push(r.snap0);
      if (S.undo.length > 150) S.undo.shift();
      S.redo = [];
    }
  };
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.defaultPrevented || e.ctrlKey || e.metaKey) return;
    const inp = numberField(e.target);
    if (!inp) return;
    e.preventDefault();
    const numeric = inp.getAttribute('inputmode') === 'numeric',
      k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1,
      step = (numeric ? 1 : KEY_STEP[inp.id] || 1) * k,
      cur = readV(inp),
      start = isFinite(cur) ? cur : parseFloat(inp.placeholder) || 0;
    let v = start + (e.key === 'ArrowUp' ? step : -step);
    // keep the value's own decimals (2.37 + 1 = 3.37) without float noise (0.1 + 0.2)
    v = numeric ? Math.round(v) : Math.round(v * 1e4) / 1e4;
    if (!run || run.el !== inp) {
      end();
      run = { el: inp, undo0: S.undo.slice(), snap0: JSON.stringify(doc) };
    }
    const find = locator(inp),
      caret = inp.selectionStart === 0 && inp.selectionEnd === inp.value.length;
    inp.value = writeV(inp, v);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    // the panel may draw the field again (now or on the next frame): keep typing in it
    const refocus = () => {
      const now = find();
      if (!now) return;
      if (document.activeElement !== now) {
        now.focus();
        if (caret) now.select();
        else now.setSelectionRange(now.value.length, now.value.length);
      }
      if (run) run.el = now;
    };
    refocus();
    keep = { refocus, until: performance.now() + 400 };
  });
  document.addEventListener('keyup', (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') end();
  });
  // the field was drawn again a moment after a press (the old one, focused, was removed): focus the new one
  document.addEventListener(
    'focusout',
    (e: FocusEvent) => {
      const k = keep;
      if (!k || performance.now() > k.until || e.relatedTarget) return;
      setTimeout(() => {
        if (!(e.target as Element).isConnected) k.refocus();
      }, 0);
    },
    true,
  );
  window.addEventListener('blur', end);
}

export function initScrub(): void {
  initArrows();
  // after a drag on a label (here or in the inspector), its click must not focus the field; a plain
  // click still does, as a label click would
  let down: { x: number; y: number } | null = null;
  document.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      down =
        (e.target as any).closest && (e.target as Element).closest('.nf > span')
          ? { x: e.clientX, y: e.clientY }
          : null;
    },
    true,
  );
  document.addEventListener(
    'click',
    (e: MouseEvent) => {
      const d = down;
      down = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 2) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  document.addEventListener('pointerdown', (e: PointerEvent) => {
    // the inspector's own animatable fields are scrubbed there (it prevents the default)
    if (e.button !== 0 || e.defaultPrevented) return;
    const hit = scrubTarget(e.target);
    if (!hit) return;
    e.preventDefault();
    const { lab, inp } = hit,
      find = locator(inp),
      numeric = inp.getAttribute('inputmode') === 'numeric',
      step = scrubStep(lab, inp),
      start = readV(inp) || parseFloat(inp.placeholder) || 0,
      x0 = e.clientX,
      // the field's own handlers may each make an undo step: the drag keeps just one
      undo0 = S.undo.slice(),
      snap0 = JSON.stringify(doc);
    let raf = 0,
      last: PointerEvent | null = null,
      moved = false;
    const apply = () => {
      raf = 0;
      const ev = last,
        el = find();
      if (!ev || !el) return;
      const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      let v = start + (ev.clientX - x0) * step * k;
      v = numeric ? Math.round(v) : Math.round(v / (step * k)) * (step * k);
      const s = writeV(el, v);
      if (el.value === s) return;
      moved = true;
      el.value = s;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const move = (ev: PointerEvent) => {
      last = ev;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (raf) {
        cancelAnimationFrame(raf);
        apply();
      }
      document.body.classList.remove('scrubbing');
      if (!moved) return;
      if (doc && JSON.stringify(doc) !== snap0) {
        S.undo = undo0;
        S.undo.push(snap0);
        if (S.undo.length > 150) S.undo.shift();
        S.redo = [];
      }
    };
    document.body.classList.add('scrubbing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}
