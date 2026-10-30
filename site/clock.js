// SVGcinema — a clock the website's clip recorder (site/captures.py) controls.
// Injected before the editor's own scripts. Until __freeze() the page runs in real time; after it, time moves
// only when __tick(ms) is called: performance.now, Date.now, requestAnimationFrame, timers, CSS animations and
// transitions (Web Animations) and SMIL all follow it, so every recorded frame is exactly 1/fps apart however
// long each screenshot takes.
(() => {
  const W = window,
    P = performance,
    rNow = P.now.bind(P),
    rDate = Date.now,
    rRAF = W.requestAnimationFrame.bind(W),
    rCAF = W.cancelAnimationFrame.bind(W),
    rST = W.setTimeout.bind(W),
    rCT = W.clearTimeout.bind(W),
    rSI = W.setInterval.bind(W),
    rCI = W.clearInterval.bind(W);
  let on = false,
    now = 0,
    dateOff = 0,
    id = 1e7;
  const raf = new Map(),
    tim = new Map(),
    ours = new WeakMap();
  P.now = () => (on ? now : rNow());
  Date.now = () => (on ? dateOff + now : rDate());
  W.requestAnimationFrame = cb => {
    if (!on) return rRAF(cb);
    const i = ++id;
    raf.set(i, cb);
    return i;
  };
  W.cancelAnimationFrame = i => {
    raf.delete(i);
    rCAF(i);
  };
  const add = (cb, ms, a, iv) => {
    const i = ++id,
      d = Math.max(iv ? 1 : 0, +ms || 0);
    tim.set(i, { cb, a, at: now + d, iv: iv ? d : 0 });
    return i;
  };
  W.setTimeout = (cb, ms, ...a) => (on ? add(cb, ms, a, false) : rST(cb, ms, ...a));
  W.setInterval = (cb, ms, ...a) => (on ? add(cb, ms, a, true) : rSI(cb, ms, ...a));
  W.clearTimeout = i => {
    tim.delete(i);
    rCT(i);
  };
  W.clearInterval = i => {
    tim.delete(i);
    rCI(i);
  };
  const run = f => {
    try {
      f();
    } catch (e) {
      console.error(e);
    }
  };
  const anims = dt => {
    for (const a of document.getAnimations()) {
      let t = ours.get(a);
      if (t === undefined) {
        if (a.playState !== 'running') continue; // paused by the page itself
        t = 0;
      }
      t += dt;
      ours.set(a, t);
      a.pause();
      a.currentTime = t + (a._start || 0);
    }
    for (const s of document.querySelectorAll('svg')) {
      if (s.ownerSVGElement) continue;
      run(() => {
        if (!s.__vt) {
          s.__vt = s.getCurrentTime();
          s.pauseAnimations();
        }
        s.__vt += dt / 1000;
        s.setCurrentTime(s.__vt);
      });
    }
  };
  W.__freeze = () => {
    if (on) return;
    now = rNow();
    dateOff = rDate() - now;
    on = true;
    // animations already running keep their place
    for (const a of document.getAnimations())
      if (a.playState === 'running') {
        a._start = 0;
        ours.set(a, a.currentTime || 0);
        a.pause();
      }
  };
  W.__tick = dt => {
    if (!on) W.__freeze();
    const end = now + dt;
    for (;;) {
      let next = null;
      for (const e of tim) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      const [i, t] = next;
      now = Math.max(now, t.at);
      if (t.iv) t.at += t.iv;
      else tim.delete(i);
      run(() => (typeof t.cb === 'function' ? t.cb(...t.a) : (0, eval)(t.cb)));
    }
    now = end;
    const cbs = [...raf];
    raf.clear();
    for (const [, cb] of cbs) run(() => cb(now));
    anims(dt);
  };
})();
