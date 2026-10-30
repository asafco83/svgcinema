// SVGcinema — help/ghost
// "Show me" in a guided tour: a pointer glides to the control and does the step the way a person would,
// with the same pointer and key events, so the editor's own code handles them (nothing is set behind its
// back). The website's step clips are recordings of these. Timing uses timers, so the clip recorder's clock
// (site/clock.js) drives it frame by frame.

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const ease = (t: number) => t * t * (3 - 2 * t);
export interface XY {
  x: number;
  y: number;
}
const ARROW =
  '<svg width="22" height="26" viewBox="0 0 22 26" aria-hidden="true"><path d="M2 2l17 11.5-7.4 1.4 4.4 8.3-3.2 1.7-4.4-8.4L2 21.6z" fill="#161a25" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';

let el: HTMLElement | null = null,
  at: XY = { x: innerWidth / 2, y: innerHeight / 2 };
/** where the pointer went during a step, and the controls it pressed (a step's clip is cropped to it) */
let box: DOMRect | null = null;
export const ghostBox = () => box;
export const resetGhostBox = () => {
  box = null;
};
/** Adds a box to where the pointer went (the box of a control it pressed, or a point with some room). */
export function addBox(r: DOMRect) {
  if (!r.width && !r.height) return;
  if (!box) box = new DOMRect(r.x, r.y, r.width, r.height);
  else {
    const x = Math.min(box.left, r.left),
      y = Math.min(box.top, r.top);
    box = new DOMRect(x, y, Math.max(box.right, r.right) - x, Math.max(box.bottom, r.bottom) - y);
  }
}
/** a control pressed: its box, unless it is a big area (the canvas, a panel) */
function pressed(t: Element | null) {
  if (!t || !t.isConnected) return;
  const r = t.getBoundingClientRect();
  if (r.width < innerWidth * 0.4 && r.height < innerHeight * 0.4) addBox(r);
}

function cursor() {
  if (!el) {
    el = document.createElement('div');
    el.className = 'tg-ghost';
    el.innerHTML = ARROW + '<i class="tg-ring"></i><b class="tg-key" hidden></b>';
    document.body.appendChild(el);
  }
  el.hidden = false;
  return el;
}
function place(p: XY) {
  at = p;
  const c = cursor();
  c.style.transform = `translate(${p.x}px, ${p.y}px)`;
}
export function hideGhost() {
  if (el) el.hidden = true;
}

/** The middle of an element (or of a point inside it, as fractions of its box). */
export function centre(t: Element, fx = 0.5, fy = 0.5): XY {
  const r = t.getBoundingClientRect();
  return { x: r.left + r.width * fx, y: r.top + r.height * fy };
}
const point = (p: XY) => addBox(new DOMRect(p.x - 30, p.y - 24, 60, 52));
async function glide(to: XY, ms = 520) {
  const from = { ...at };
  point(to); // where it goes (not the way there from the last step)
  cursor();
  const n = Math.max(1, Math.round(ms / 20));
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n);
    place({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    await wait(20);
  }
}
function ring() {
  const r = cursor().querySelector('.tg-ring') as HTMLElement;
  r.classList.remove('go');
  void r.offsetWidth;
  r.classList.add('go');
}
/** What is under a point, leaving out the tour's own card and light. */
function hit(p: XY): Element {
  return document.elementsFromPoint(p.x, p.y).find(e => !e.closest('.tg-card, .tg-ghost, .tg-spot')) || document.body;
}
function pointer(type: string, p: XY, o: { shift?: boolean; buttons?: number; target?: Element | null } = {}) {
  // like pointer capture: the element pressed gets the rest of the drag (while it is still in the page)
  const t = o.target && o.target.isConnected ? o.target : hit(p);
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: p.x,
    clientY: p.y,
    button: 0,
    buttons: o.buttons ?? (type === 'pointerup' || type === 'mouseup' || type === 'click' ? 0 : 1),
    shiftKey: !!o.shift,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };
  const ev = type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init);
  t.dispatchEvent(ev);
  return t;
}

/** Glide to an element and click it (pointer down and up, then click). */
export async function click(t: Element | null, fx = 0.5, fy = 0.5) {
  if (!t) return;
  const p = centre(t, fx, fy);
  await glide(p);
  await wait(120);
  // the editor may have drawn the control again meanwhile (e.g. while it plays): click what is there now
  if (!t.isConnected) t = hit(p);
  ring();
  pressed(t);
  pointer('pointerdown', p, { target: t });
  pointer('mousedown', p, { target: t });
  await wait(60);
  pointer('pointerup', p, { target: t });
  pointer('mouseup', p, { target: t });
  pointer('click', p, { target: t });
  await wait(380);
}
/** Glide to `a`, press, move to `b` in small steps, let go. */
export async function drag(a: XY, b: XY, o: { shift?: boolean; ms?: number } = {}) {
  await glide(a);
  await wait(120);
  ring();
  // later events go where the press went, as with pointer capture (they bubble to the window as well)
  const t0 = pointer('pointerdown', a, { shift: o.shift });
  pressed(t0);
  pointer('mousedown', a, { shift: o.shift, target: t0 });
  const n = Math.max(6, Math.round((o.ms || 700) / 20));
  for (let i = 1; i <= n; i++) {
    const k = ease(i / n),
      p = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    place(p);
    point(p);
    pointer('pointermove', p, { shift: o.shift, target: t0 });
    await wait(20);
  }
  pointer('pointerup', b, { shift: o.shift, target: t0 });
  pointer('mouseup', b, { shift: o.shift, target: t0 });
  await wait(380);
}
/** Show a key on the pointer and press it (keydown, then keyup). */
export async function press(label: string, key: string, code: string) {
  const k = cursor().querySelector('.tg-key') as HTMLElement;
  k.textContent = label;
  k.hidden = false;
  await wait(260);
  const t = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
  t.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
  await wait(80);
  t.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }));
  await wait(420);
  k.hidden = true;
}
/** Click a text field, type into it a character at a time, then Enter. */
export async function type(t: HTMLInputElement | null, text: string) {
  if (!t) return;
  await click(t);
  t.focus();
  t.select();
  t.value = '';
  for (const ch of text) {
    t.value += ch;
    t.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(140);
  }
  t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  t.dispatchEvent(new Event('change', { bubbles: true }));
  t.blur();
  await wait(400);
}
