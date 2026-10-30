// SVGcinema — ui/color-picker
// Our own color picker popup (the browser's can't hold gradient settings). One window for:
//   type      None · Solid · Linear · Radial (which types are offered depends on the property)
//   gradient  the stop bar (drag a stop, click the bar to add one, remove), angle or centre + radius
//   color    saturation/brightness area, hue and opacity sliders, eyedropper, hex and R G B A fields
// For a gradient the color part edits the selected stop. Changes apply live; closing the window
// (click outside, Esc) commits them as one undo step.
import { $, H, ICON, clamp, clone, esc, fmt, r3 } from '../core/constants';

export type PaintType = 'none' | 'solid' | 'lin' | 'rad';
export type Grad = {
  g: 'lin' | 'rad';
  s: Array<[number, string]>;
  a?: number;
  p?: number[];
  cx?: number;
  cy?: number;
  r?: number;
  ra?: number;
  rr?: number;
};
/** a linear gradient's angle (°, 0 = up) from its end points */
export function linAngle(g: Grad) {
  if (!g.p) return g.a ?? 90;
  const [x1, y1, x2, y2] = g.p;
  return r3(((((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI + 90) % 360) + 360) % 360);
}
export interface PaintTarget {
  /** current value: a color string, 'none', or a gradient */
  get(): any;
  /** apply a value while the window is open */
  set(v: any): void;
  /** the window closed: commit */
  done(): void;
  types: PaintType[];
  label: string;
  /** the layer and property being painted (lets the canvas show gradient handles) */
  layer?: string;
  key?: string;
}

/* ---------- color maths ---------- */

type RGBA = [number, number, number, number];
const isG = (v: any): v is Grad => !!H.isG(v);
export function rgbaOf(c: unknown): RGBA {
  const q = typeof c === 'string' ? H.pc(c) : null;
  return q ? [q[0], q[1], q[2], q[3]] : [0, 0, 0, 1];
}
export function toCSS(c: RGBA) {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${r3(c[3])})`;
}
/** '#rrggbb' when opaque, rgba() otherwise */
export function toValue(c: RGBA) {
  const hex =
    '#' +
    [0, 1, 2]
      .map(i =>
        Math.round(clamp(c[i], 0, 255))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  return c[3] >= 0.999 ? hex : `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${r3(c[3])})`;
}
function rgb2hsv([r, g, b]: RGBA): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c,
    [r, g, b] =
      h < 60
        ? [c, x, 0]
        : h < 120
          ? [x, c, 0]
          : h < 180
            ? [0, c, x]
            : h < 240
              ? [0, x, c]
              : h < 300
                ? [x, 0, c]
                : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function gradAt(g: Grad, o: number): string {
  const s = g.s;
  if (o <= s[0][0]) return s[0][1];
  for (let i = 0; i < s.length - 1; i++)
    if (o <= s[i + 1][0]) {
      const w = s[i + 1][0] - s[i][0],
        p = w > 0 ? (o - s[i][0]) / w : 0,
        A = rgbaOf(s[i][1]),
        B = rgbaOf(s[i + 1][1]);
      return toValue([0, 1, 2, 3].map(j => A[j] + (B[j] - A[j]) * p) as RGBA);
    }
  return s[s.length - 1][1];
}
export function barCSS(g: Grad) {
  return `linear-gradient(90deg, ${g.s.map(([o, c]) => `${toCSS(rgbaOf(c))} ${r3(o * 100)}%`).join(', ')})`;
}
/** CSS background for a swatch showing this paint (gradients as they look, roughly). */
export function paintCSS(v: any): string {
  if (isG(v)) {
    const stops = v.s.map(([o, c]) => `${toCSS(rgbaOf(c))} ${r3(o * 100)}%`).join(', ');
    return v.g === 'rad'
      ? `radial-gradient(circle at ${r3((v.cx ?? 0.5) * 100)}% ${r3((v.cy ?? 0.5) * 100)}%, ${stops})`
      : `linear-gradient(${r3(v.a ?? 90)}deg, ${stops})`;
  }
  return toCSS(rgbaOf(v));
}
export function isNone(v: any) {
  if (isG(v)) return false;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return !s || s === 'none' || s === 'transparent' || rgbaOf(s)[3] <= 0;
}
/** Show a value on a swatch button: the paint over a checkerboard, or the "no color" mark. */
export function showSwatch(b: HTMLElement, v: any) {
  const none = isNone(v);
  b.classList.toggle('none', none);
  (b.querySelector('i') as HTMLElement).style.background = none ? '' : paintCSS(v);
  b.title = none ? 'No color' : isG(v) ? (v.g === 'rad' ? 'Radial gradient' : 'Linear gradient') : toValue(rgbaOf(v));
}

/* ---------- the window ---------- */

let T: PaintTarget | null = null,
  val: any = null,
  stop = 0,
  hsv: [number, number, number] = [0, 0, 0],
  alpha = 1,
  anchor: HTMLElement | null = null;
const POP = () => $('#cpop') as HTMLElement;
// told when the window opens or closes (the canvas shows / hides gradient handles)
const watchers: Array<() => void> = [];
export function onPicker(fn: () => void) {
  watchers.push(fn);
}
const tell = () => watchers.forEach(f => f());
export function pickerOpen() {
  return !!T;
}
/** what the window is painting, for the canvas gradient handles */
export function pickerPaint(): { layer: string; key: string; val: any } | null {
  return T && T.layer ? { layer: T.layer, key: T.key, val } : null;
}
/** a change made outside the window (dragging a gradient handle on the canvas) */
export function pickerApply(v: any) {
  if (!T) return;
  val = clone(v);
  T.set(clone(val));
  const p = POP();
  p.querySelectorAll<HTMLInputElement>('[data-cpg]').forEach(e => {
    const k = e.dataset.cpg,
      g = val as Grad;
    e.value = k === 'a' ? fmt(linAngle(g)) : fmt(((g as any)[k] ?? 0.5) * 100);
  });
  paint();
}
/** color the picker edits: the solid value, or the selected stop */
function curColor(): string {
  if (isG(val)) return val.s[Math.min(stop, val.s.length - 1)][1];
  return isNone(val) ? '#000000' : val;
}
function loadHSV() {
  const c = rgbaOf(curColor());
  const h = rgb2hsv(c);
  // keep the hue when the color is grey (it has none)
  hsv = [h[1] ? h[0] : hsv[0], h[1], h[2]];
  alpha = c[3];
}
function writeColor(live = true) {
  const [r, g, b] = hsv2rgb(hsv[0], hsv[1], hsv[2]),
    c = toValue([r, g, b, alpha]);
  if (isG(val)) {
    val = clone(val);
    val.s[Math.min(stop, val.s.length - 1)][1] = c;
  } else val = c;
  T.set(clone(val));
  paint();
  if (!live) render();
}
function typeOf(v: any): PaintType {
  return isG(v) ? v.g : isNone(v) ? 'none' : 'solid';
}
const ICONS: Record<PaintType, string> = {
  none: '<span class="g-ic g-none"></span>',
  solid: '<span class="g-ic g-solid"></span>',
  lin: '<span class="g-ic g-lin"></span>',
  rad: '<span class="g-ic g-rad"></span>',
};
const NAMES: Record<PaintType, string> = {
  none: 'None',
  solid: 'Solid color',
  lin: 'Linear gradient',
  rad: 'Radial gradient',
};
function render() {
  const p = POP(),
    ty = typeOf(val),
    g = isG(val) ? val : null;
  let h = `<div class="cp-head"><span class="cp-title">${esc(T.label)}</span><div class="btns tight">${T.types
    .map(
      t =>
        `<button class="btn ib tg${t === ty ? ' on' : ''}" data-cpt="${t}" aria-pressed="${t === ty}" title="${NAMES[t]}" aria-label="${NAMES[t]}">${ICONS[t]}</button>`,
    )
    .join('')}</div></div>`;
  if (g) {
    const i = Math.min(stop, g.s.length - 1);
    h += `<div class="g-bar" data-cpbar style="background:${barCSS(g)}" title="Click to add a stop; drag a stop to move it">${g.s
      .map(
        ([o], j) =>
          `<button class="g-stop${j === i ? ' sel' : ''}" data-cpstop="${j}" style="left:${r3(o * 100)}%" aria-label="Stop ${j + 1}"></button>`,
      )
      .join('')}</div>
      <div class="cp-grow">
        <label class="nf"><span>@</span><input data-cpoff inputmode="decimal" value="${fmt(g.s[i][0] * 100)}" aria-label="Stop position"><em>%</em></label>
        <button class="btn ib" data-cpdel ${g.s.length > 2 ? '' : 'disabled'} title="Remove this stop" aria-label="Remove stop">−</button>
        ${g.g === 'rad' ? '</div><div class="cp-grow">' : ''}${
          g.g === 'lin'
            ? `<label class="nf"><span>∠</span><input data-cpg="a" inputmode="decimal" value="${fmt(linAngle(g))}" aria-label="Angle"><em>°</em></label>`
            : `<label class="nf"><span>X</span><input data-cpg="cx" inputmode="decimal" value="${fmt((g.cx ?? 0.5) * 100)}" aria-label="Center X"><em>%</em></label><label class="nf"><span>Y</span><input data-cpg="cy" inputmode="decimal" value="${fmt((g.cy ?? 0.5) * 100)}" aria-label="Center Y"><em>%</em></label><label class="nf"><span>R</span><input data-cpg="r" inputmode="decimal" value="${fmt((g.r ?? 0.5) * 100)}" aria-label="Radius"><em>%</em></label>`
        }
      </div>`;
  }
  if (ty === 'none') h += `<p class="cp-none">No color</p>`;
  else {
    const eye = typeof (window as any).EyeDropper === 'function';
    h += `<div class="cp-sv" data-cpsv><i class="cp-knob"></i></div>
      <div class="cp-mid">
        ${eye ? `<button class="btn ib" data-cpeye title="Pick a color from the screen" aria-label="Pick a color from the screen">${ICON.eyedropper}</button>` : ''}
        <span class="cp-prev"><i></i></span>
        <div class="cp-sliders"><div class="cp-hue" data-cphue><i></i></div><div class="cp-alpha" data-cpalpha><b></b><i></i></div></div>
      </div>
      <div class="cp-fields">
        <label><input data-cphex spellcheck="false" aria-label="Hex"><span>Hex</span></label>
        <label><input data-cprgb="0" inputmode="numeric" aria-label="Red"><span>R</span></label>
        <label><input data-cprgb="1" inputmode="numeric" aria-label="Green"><span>G</span></label>
        <label><input data-cprgb="2" inputmode="numeric" aria-label="Blue"><span>B</span></label>
        <label><input data-cpa inputmode="numeric" aria-label="Opacity"><span>A %</span></label>
      </div>`;
  }
  p.innerHTML = h;
  paint();
}
/** update the color widgets without rebuilding the window */
function paint() {
  const p = POP();
  if (!p || p.hidden) return;
  const [r, g, b] = hsv2rgb(hsv[0], hsv[1], hsv[2]),
    c: RGBA = [r, g, b, alpha],
    sv = p.querySelector('.cp-sv') as HTMLElement;
  if (sv) {
    const hueC = hsv2rgb(hsv[0], 1, 1);
    sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, rgb(${hueC.map(Math.round).join(',')}))`;
    const k = sv.querySelector('.cp-knob') as HTMLElement;
    k.style.left = hsv[1] * 100 + '%';
    k.style.top = (1 - hsv[2]) * 100 + '%';
    (p.querySelector('.cp-hue i') as HTMLElement).style.left = (hsv[0] / 360) * 100 + '%';
    const al = p.querySelector('.cp-alpha') as HTMLElement;
    (al.querySelector('b') as HTMLElement).style.background =
      `linear-gradient(to right, transparent, rgb(${[r, g, b].map(Math.round).join(',')}))`;
    (al.querySelector('i') as HTMLElement).style.left = alpha * 100 + '%';
    (p.querySelector('.cp-prev i') as HTMLElement).style.background = toCSS(c);
    const set = (sel: string, v: string) => {
      const e = p.querySelector(sel) as HTMLInputElement;
      if (e && e !== document.activeElement) e.value = v;
    };
    set('[data-cphex]', toValue([r, g, b, 1]).slice(1).toUpperCase());
    [r, g, b].forEach((x, i) => set(`[data-cprgb="${i}"]`, String(Math.round(x))));
    set('[data-cpa]', String(Math.round(alpha * 100)));
  }
  if (isG(val)) {
    const bar = p.querySelector('[data-cpbar]') as HTMLElement;
    if (bar) {
      bar.style.background = barCSS(val);
      (bar.querySelectorAll('.g-stop') as NodeListOf<HTMLElement>).forEach((s, j) => {
        if (!val.s[j]) return;
        s.style.left = r3(val.s[j][0] * 100) + '%';
        s.style.setProperty('--c', toCSS(rgbaOf(val.s[j][1])));
        s.classList.toggle('sel', j === stop);
      });
    }
  }
  if (anchor) showSwatch(anchor, val);
}
function place() {
  const p = POP(),
    r = anchor.getBoundingClientRect(),
    pr = p.getBoundingClientRect();
  let x = r.left - pr.width - 8;
  if (x < 8) x = Math.min(innerWidth - pr.width - 8, r.right + 8);
  p.style.left = Math.max(8, x) + 'px';
  p.style.top = Math.max(8, Math.min(r.top - 40, innerHeight - pr.height - 8)) + 'px';
}
export function openPicker(btn: HTMLElement, target: PaintTarget) {
  if (T && anchor === btn) return closePicker();
  if (T) closePicker();
  T = target;
  anchor = btn;
  val = clone(target.get());
  stop = 0;
  loadHSV();
  const p = POP();
  p.hidden = false;
  render();
  place();
  btn.setAttribute('aria-expanded', 'true');
  tell();
}
export function closePicker() {
  if (!T) return;
  const t = T;
  T = null;
  POP().hidden = true;
  if (anchor) anchor.setAttribute('aria-expanded', 'false');
  anchor = null;
  t.done();
  tell();
}
function setType(t: PaintType) {
  const c = curColor(),
    ty = typeOf(val);
  if (t === ty) return;
  if (t === 'none') val = 'none';
  else if (t === 'solid') val = isG(val) ? val.s[0][1] : c;
  else if (isG(val)) val = { ...clone(val), g: t };
  else {
    const base = isNone(val) ? '#5B7CFA' : val,
      q = rgbaOf(base);
    val =
      t === 'lin'
        ? {
            g: 'lin',
            a: 90,
            s: [
              [0, base],
              [1, toValue([q[0], q[1], q[2], 0])],
            ],
          }
        : {
            g: 'rad',
            cx: 0.5,
            cy: 0.5,
            r: 0.5,
            s: [
              [0, base],
              [1, toValue([q[0], q[1], q[2], 0])],
            ],
          };
    stop = 0;
  }
  if (t === 'solid' && isNone(val)) val = '#5B7CFA';
  loadHSV();
  T.set(clone(val));
  render();
}
function drag(e: PointerEvent, el: HTMLElement, fn: (x: number, y: number) => void) {
  e.preventDefault();
  const go = (ev: PointerEvent) => {
    const r = el.getBoundingClientRect();
    fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
  };
  go(e);
  const up = () => {
    window.removeEventListener('pointermove', go);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', go);
  window.addEventListener('pointerup', up);
}
export function init(): void {
  const p = POP();
  p.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!T) return;
    const t = e.target as HTMLElement;
    const sv = t.closest('[data-cpsv]') as HTMLElement,
      hue = t.closest('[data-cphue]') as HTMLElement,
      al = t.closest('[data-cpalpha]') as HTMLElement,
      st = t.closest('[data-cpstop]') as HTMLElement,
      bar = t.closest('[data-cpbar]') as HTMLElement;
    if (sv)
      return drag(e, sv, (x, y) => {
        hsv = [hsv[0], x, 1 - y];
        writeColor();
      });
    if (hue)
      return drag(e, hue, x => {
        hsv = [x * 359.9, hsv[1], hsv[2]];
        writeColor();
      });
    if (al)
      return drag(e, al, x => {
        alpha = r3(x);
        writeColor();
      });
    if ((st || bar) && isG(val)) {
      const barEl = (bar || st.parentElement) as HTMLElement;
      if (st) stop = +st.dataset.cpstop;
      else {
        // a new stop where the bar was clicked, in the color the gradient has there
        const r = barEl.getBoundingClientRect(),
          o = r3(clamp((e.clientX - r.left) / r.width, 0, 1)),
          g = clone(val) as Grad;
        g.s.push([o, gradAt(val, o)]);
        g.s.sort((a, b) => a[0] - b[0]);
        stop = g.s.findIndex(s => s[0] === o);
        val = g;
        T.set(clone(val));
        render();
      }
      loadHSV();
      render();
      const bar2 = POP().querySelector('[data-cpbar]') as HTMLElement;
      drag(e, bar2, x => {
        const g = clone(val) as Grad,
          s = g.s[stop];
        s[0] = r3(x);
        g.s.sort((a, b) => a[0] - b[0]);
        stop = g.s.indexOf(s);
        val = g;
        T.set(clone(val));
        paint();
        const off = POP().querySelector('[data-cpoff]') as HTMLInputElement;
        if (off) off.value = fmt(s[0] * 100);
      });
    }
  });
  p.addEventListener('click', (e: MouseEvent) => {
    if (!T) return;
    const t = e.target as HTMLElement,
      ty = t.closest('[data-cpt]') as HTMLElement;
    if (ty) return setType(ty.dataset.cpt as PaintType);
    if (t.closest('[data-cpdel]') && isG(val) && val.s.length > 2) {
      const g = clone(val) as Grad;
      g.s.splice(stop, 1);
      stop = Math.max(0, stop - 1);
      val = g;
      T.set(clone(val));
      loadHSV();
      return render();
    }
    if (t.closest('[data-cpeye]'))
      new (window as any).EyeDropper()
        .open()
        .then((r: { sRGBHex: string }) => {
          const h = rgb2hsv(rgbaOf(r.sRGBHex));
          hsv = h;
          writeColor(false);
        })
        .catch(() => {});
  });
  p.addEventListener('change', (e: Event) => {
    if (!T) return;
    const t = e.target as HTMLInputElement,
      d = t.dataset;
    if (d.cphex !== undefined) {
      const s = t.value.trim().replace(/^#?/, '#');
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) {
        const c = rgbaOf(s);
        hsv = rgb2hsv(c);
        writeColor(false);
      } else paint();
    } else if (d.cprgb !== undefined) {
      const [r, g, b] = hsv2rgb(hsv[0], hsv[1], hsv[2]),
        c: RGBA = [r, g, b, alpha];
      c[+d.cprgb] = clamp(parseFloat(t.value) || 0, 0, 255);
      const h = rgb2hsv(c);
      hsv = [h[1] ? h[0] : hsv[0], h[1], h[2]];
      writeColor(false);
    } else if (d.cpa !== undefined) {
      alpha = clamp((parseFloat(t.value) || 0) / 100, 0, 1);
      writeColor(false);
    } else if (d.cpoff !== undefined && isG(val)) {
      const g = clone(val) as Grad,
        s = g.s[stop];
      s[0] = r3(clamp((parseFloat(t.value) || 0) / 100, 0, 1));
      g.s.sort((a, b) => a[0] - b[0]);
      stop = g.s.indexOf(s);
      val = g;
      T.set(clone(val));
      render();
    } else if (d.cpg && isG(val)) {
      const g = clone(val) as any,
        v = parseFloat(t.value);
      if (isFinite(v) && d.cpg === 'a' && g.p) {
        // placed end points: turn them around their middle
        const [x1, y1, x2, y2] = g.p,
          mx = (x1 + x2) / 2,
          my = (y1 + y2) / 2,
          h = Math.hypot(x2 - x1, y2 - y1) / 2,
          t = ((v - 90) * Math.PI) / 180;
        g.p = [mx - Math.cos(t) * h, my - Math.sin(t) * h, mx + Math.cos(t) * h, my + Math.sin(t) * h].map(r3);
        g.a = r3(v);
      } else if (isFinite(v))
        g[d.cpg] = d.cpg === 'a' ? r3(v) : r3(clamp(v, d.cpg === 'r' ? 1 : -100, d.cpg === 'r' ? 300 : 200) / 100);
      val = g;
      T.set(clone(val));
      paint();
    }
  });
  // Esc closes the window wherever the focus is (before the app's own Esc handling)
  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (T && e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        closePicker();
      }
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      const t = e.target as Element;
      if (
        T &&
        !p.contains(t) &&
        t !== anchor &&
        !(anchor && anchor.contains(t)) &&
        !(t.closest && t.closest('[data-gh]'))
      )
        closePicker();
    },
    true,
  );
}
