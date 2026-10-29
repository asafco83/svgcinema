// SVGcinema — runtime/scrub
// Playback › Starts › Linked to scroll: the animation's time follows where the SVG is in the window
// (or in the nearest box that scrolls), so scrolling down plays it and scrolling back plays it
// backwards. Like CinEngine it is self-contained, plain ES5-style code with no imports: the export
// writes `cinScrub.toString()` into the SVG (export/build: triggerJS), and the external player calls
// it directly (runtime/boot).
//
// c.r = [from edge, from %, to edge, to %]: it starts when that edge of the SVG (0 top, 0.5 centre,
// 1 bottom) reaches that point of the window (0% its top, 100% its bottom), and ends likewise.
// c.sm = smoothing in seconds (how long the animation takes to catch up with the scroll).
// c.b = -1 when the animation runs in reverse.

export interface ScrubConfig {
  r: number[];
  sm?: number;
  b?: number;
}
export interface ScrubHandle {
  /** how far through the range the SVG is now (0–1) */
  progress(): number;
  /** the same from numbers: the SVG's top and height, the window's top and height (px) */
  at(top: number, height: number, winTop: number, winHeight: number): number;
  /** re-read the scroll position */
  update(): void;
  /** the box that scrolls it (null: the window) */
  box: Element | null;
}

export function cinScrub(s: any, P: any, c: any): ScrubHandle {
  var r = (c && c.r) || [0, 100, 1, 0],
    sm = Math.max(0, +(c && c.sm) || 0),
    back = !!c && c.b === -1,
    win: any = window,
    el: any = s,
    box: any = null;
  // shown with <object>, <embed> or <iframe> from the same site: follow that frame in the page around it
  try {
    if (win.frameElement && win.parent && win.parent !== win) {
      el = win.frameElement;
      win = win.parent;
    }
  } catch (e) {}
  // the nearest box that scrolls on its own, else the window
  var root = win.document.documentElement,
    body = win.document.body;
  for (var p = el.parentNode; p && p.nodeType === 1 && p !== root && p !== body; p = p.parentNode) {
    var oy = win.getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && p.scrollHeight > p.clientHeight) {
      box = p;
      break;
    }
  }
  function at(top: number, h: number, vt: number, vh: number) {
    // how far there is still to scroll before it starts, and before it ends
    var us = top + r[0] * h - (vt + (r[1] / 100) * vh),
      ue = top + r[2] * h - (vt + (r[3] / 100) * vh);
    if (ue <= us) return us <= 0 ? 1 : 0;
    return Math.max(0, Math.min(1, -us / (ue - us)));
  }
  function progress() {
    var b = el.getBoundingClientRect(),
      vt = 0,
      vh = win.innerHeight || root.clientHeight;
    if (box) {
      vt = box.getBoundingClientRect().top + box.clientTop;
      vh = box.clientHeight;
    }
    return at(b.top, b.height, vt, vh);
  }
  var tau = sm / 3,
    cur = -1,
    target = 0,
    raf: any = 0,
    last = 0,
    req =
      win.requestAnimationFrame ||
      function (f: any) {
        return setTimeout(function () {
          f(Date.now());
        }, 16);
      },
    cancel = win.cancelAnimationFrame || clearTimeout;
  function frame(now: number) {
    raf = 0;
    var dt = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    if (cur < 0 || !tau) cur = target;
    else cur += (target - cur) * (1 - Math.exp(-dt / tau));
    if (Math.abs(target - cur) < 0.5) cur = target;
    P.seekTo(cur);
    if (cur !== target) raf = req(frame);
    else last = 0;
  }
  function update() {
    var d = P.duration || 0;
    target = progress() * d;
    if (back) target = d - target;
    if (!raf) raf = req(frame);
  }
  var src = box || win,
    opt = { passive: true };
  src.addEventListener('scroll', update, opt);
  win.addEventListener('resize', update);
  if (P._cleanup)
    P._cleanup.push(function () {
      src.removeEventListener('scroll', update, opt);
      win.removeEventListener('resize', update);
      if (raf) cancel(raf);
      raf = 0;
    });
  // the frame for where it is now, at once (no glide when the page opens)
  update();
  if (raf) cancel(raf);
  raf = 0;
  cur = target;
  P.seekTo(cur);
  return { progress: progress, at: at, update: update, box: box };
}
