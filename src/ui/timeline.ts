// SVGcinema — ui/timeline
import { VIEW } from '../core/view';
import { graphNames, graphSVG, graphTrack, graphable, updateGraphValues } from './graph';
import type { Keyframe, Layer, PropKey } from '../model/types';
import { $, ICON, clamp, clock, clone, esc, fmt, isFrozen, layerTracks, propLabel, r3 } from '../core/constants';
import { TLB, TLS } from '../core/dom';
import { beginEdit, setTime } from '../core/history';
import { closeMenu } from '../core/keyframes';
import { S, doc, layerById, sortTrack } from '../core/state';
import { ancestors, hasTracks, isHidden, treeRows } from '../model/tree';
import { frame, tc } from '../render/stage';
import { easeLabel } from './easing';
import { focusProp, renderInspector } from './inspector';
import { renderLayers } from './layers-panel';
import { poseKeys, poseLabel, poseRowFor, rigTimes } from '../tools/rig';

export function tln() {
  return parseFloat(getComputedStyle(TLB).getPropertyValue('--tln')) || 232;
}
/** Seconds the timeline shows: at least the animation, and enough to fill the panel;
 *  the time after the end is shaded and its end line can be dragged to change the length. */
export function shownSpan() {
  const view = Math.max(0, (TLS.clientWidth || 800) - tln() - 24) / S.pps,
    lastKey = doc.layers.reduce((m, l) => Math.max(m, ...Object.values(l.t).flatMap(tr => tr.map(q => q[0]))), 0);
  return Math.max(doc.dur + 1, view, lastKey + 0.5);
}
export function ticks(W: number, span = doc.dur) {
  const pps = S.pps,
    minor = pps >= 260 ? 0.1 : pps >= 110 ? 0.25 : 0.5,
    major = pps >= 260 ? 0.5 : pps >= 60 ? 1 : 2;
  let h = '';
  for (let t = 0; t <= span + 1e-6; t = r3(t + minor)) {
    const mj = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    h += `<div class="tk${mj ? ' mj' : ''}" style="left:${t * pps}px">${mj ? `<b>${fmt(t, 1)}s</b>` : ''}</div>`;
  }
  return h + `<div class="tl-out" style="left:${W}px"></div>`;
}
export function renderTimeline() {
  // the header's Easing button follows the selected keyframes
  const ez = document.getElementById('tEase') as HTMLButtonElement | null;
  if (ez) ez.disabled = !S.keys.size;
  const W = doc.dur * S.pps,
    span = shownSpan(),
    LW = span * S.pps + 24,
    out = `<div class="tl-out" style="left:${W}px"></div>`,
    list = treeRows()
      .map(r => r[0])
      .filter(hasTracks);
  let h = `<div class="tl-row tl-ruler"><div class="tl-name">Animated layers</div><div class="tl-lane" id="ruler" style="width:${LW}px">${ticks(W, span)}</div></div>`;
  if (!list.length)
    h += `<div class="tl-empty">Layers with keyframes appear here. Click ◆ beside a property in the inspector, or use Animate in the Layers panel, to start animating it. After that, changing it at any point in time adds a keyframe there.</div>`;
  // the Presets window's preview: its span on each layer, and the keyframes it would replace
  const pv = S.presetPv,
    pvSpan = (lid: string, k?: string) => {
      const sp = pv && pv.spans.find(x => x.lid === lid && (!k || x.props.includes(k)));
      return sp
        ? `<i class="pv-span" style="left:${sp.t0 * S.pps}px;width:${Math.max(2, (sp.t1 - sp.t0) * S.pps)}px"></i>`
        : '';
    },
    pvRep = new Set(pv ? pv.replaced : []),
    gt = graphTrack();
  for (const l of list) {
    const tracks = layerTracks(l),
      ex = S.exp[l.id] !== false;
    const live = tracks.filter(k => !isFrozen(l, k)),
      times = [...new Set<any>(live.flatMap(k => l.t[k].map(q => q[0])))],
      par = l.parent && layerById(l.parent);
    h += `<div class="tl-row tl-layer${S.selSet.has(l.id) ? ' sel' : ''}${isHidden(l) ? ' hid' : ''}" data-lid="${l.id}">
      <div class="tl-name"><button class="tl-ic" data-act="exp" aria-label="${ex ? 'Hide' : 'Show'} animators">${ex ? ICON.down : ICON.right}</button>
      ${
        par
          ? `<span class="tl-path" title="${esc(
              ancestors(l)
                .reverse()
                .map(a => a.name)
                .join(' › '),
            )}">${esc(par.name)} ›</span>`
          : ''
      }
      <span class="tl-lname" data-act="sel" title="Double-click to rename">${esc(l.name)}</span><span class="tl-type">${l.type}</span></div>
      <div class="tl-lane" data-act="lane" style="width:${LW}px">${out}<div class="tl-bar" style="width:${W}px"></div>${pvSpan(l.id)}${times
        .map(t => {
          const kat = live.flatMap(k => l.t[k].filter(q => Math.abs(q[0] - t) < 0.004));
          return `<button class="sdot${kat.length && kat.every(q => S.keys.has(q)) ? ' sel' : ''}" data-lid="${l.id}" data-t="${t}" style="left:${t * S.pps}px" aria-label="All ${esc(l.name)} keyframes at ${fmt(t)}s" title="${fmt(t)}s · all keyframes"></button>`;
        })
        .join('')}</div></div>`;
    // a rig's top bone: the Pose row shows every time any bone of the rig has a key; a Pose diamond
    // stands for all of them (drag to retime the pose, Delete to remove it)
    const rig = ex ? poseRowFor(l) : null;
    if (rig) {
      const pts = rigTimes(l);
      h += `<div class="tl-row tl-prop tl-pose${S.selSet.has(l.id) ? ' sel' : ''}" data-lid="${l.id}"><div class="tl-name"><span class="tl-pname">${esc(poseLabel(rig.length))}</span></div>
      <div class="tl-lane" data-act="lane" style="width:${LW}px">${out}<div class="tl-bar" style="width:${W}px"></div>${pts
        .map(t => {
          const ks = poseKeys(l, t);
          return `<button class="sdot pose${ks.length && ks.every(q => S.keys.has(q)) ? ' sel' : ''}" data-lid="${l.id}" data-t="${t}" data-pose="1" style="left:${t * S.pps}px" aria-label="Pose at ${fmt(t)}s" title="${fmt(t)}s · the whole rig's keyframes"></button>`;
        })
        .join('')}</div></div>`;
    }
    if (ex)
      for (const k of tracks) {
        const fz = isFrozen(l, k),
          tr = fz ? l.ft[k] : l.t[k];
        let segs = '',
          keys = '';
        for (let i = 0; i < tr.length; i++) {
          const q = tr[i],
            nx = tr[i + 1];
          // frozen: drawn greyed, without the classes the keyframe interactions look for
          if (fz) {
            if (nx && JSON.stringify(q[1]) !== JSON.stringify(nx[1]))
              segs += `<i class="segz" style="left:${q[0] * S.pps}px;width:${(nx[0] - q[0]) * S.pps}px"></i>`;
            keys += `<span class="kfz" style="left:${q[0] * S.pps}px" title="${propLabel(l, k)} · ${fmt(q[0])}s (frozen)"></span>`;
            continue;
          }
          if (nx && JSON.stringify(q[1]) !== JSON.stringify(nx[1]))
            segs += `<i class="seg${q[2] === 'hold' ? ' hold' : ''}" data-lid="${l.id}" data-prop="${k}" data-i="${i}" style="left:${q[0] * S.pps}px;width:${(nx[0] - q[0]) * S.pps}px" title="${esc(easeLabel(q[2]))} · click to edit easing"></i>`;
          keys += `<button class="kf${S.keys.has(q) ? ' sel' : ''}${q[2] === 'hold' ? ' hold' : ''}${pvRep.has(q) ? ' rep' : ''}" data-lid="${l.id}" data-prop="${k}" data-i="${i}" style="left:${q[0] * S.pps}px" aria-label="${propLabel(l, k)} keyframe at ${fmt(q[0])}s" title="${propLabel(l, k)} · ${fmt(q[0])}s · ${esc(easeLabel(q[2]))}"></button>`;
        }
        const nm = propLabel(l, k);
        const ctrls = `<button class="tl-ic tl-fz${fz ? ' on' : ''}" data-act="freeze" aria-pressed="${fz}" aria-label="${fz ? 'Unfreeze' : 'Freeze'} ${nm}" title="${fz ? `Frozen: ${nm} holds its value and its keyframes are not used. Click to unfreeze.` : `Freeze ${nm}: hold its current value and set the keyframes aside`}">${ICON.freeze}</button><span class="tl-pname" data-act="track" title="Select all ${nm} keyframes">${nm}</span>
        <button class="kb" data-act="key" ${fz ? 'disabled ' : ''}aria-label="Add or remove ${nm} keyframe at playhead"></button>
        <button class="tl-ic tl-x" data-act="rmtrack" aria-label="Remove ${nm} animation">${ICON.x}</button>`;
        // the graph editor opens this track into a value graph
        if (gt && gt.l === l && gt.k === k && !fz) {
          h += `<div class="tl-row tl-prop tl-graph${S.selSet.has(l.id) ? ' sel' : ''}" data-lid="${l.id}" data-prop="${k}"><div class="tl-name">${graphNames(l, k, `<div class="gr-ctl">${ctrls}</div>`)}</div>
          <div class="tl-lane" data-act="lane" style="width:${LW}px">${out}${graphSVG(l, k, W, LW)}</div></div>`;
          continue;
        }
        h += `<div class="tl-row tl-prop${fz ? ' frozen' : ''}${S.selSet.has(l.id) ? ' sel' : ''}${gt && graphable(l, k) ? '' : gt ? ' no-graph' : ''}" data-lid="${l.id}" data-prop="${k}"><div class="tl-name">${ctrls}</div>
        <div class="tl-lane" data-act="lane" style="width:${LW}px">${out}${fz ? '' : pvSpan(l.id, k)}${segs}${keys}</div></div>`;
      }
  }
  TLB.innerHTML =
    h +
    `<div class="tl-endline" id="tlEnd" style="left:${tln() + W}px" role="slider" aria-label="Animation length" aria-valuemin="0.1" aria-valuemax="600" aria-valuenow="${fmt(doc.dur)}" tabindex="0" title="Drag to change the animation length (${fmt(doc.dur)}s)"><span class="tl-endtip" id="tlEndTip" hidden></span></div>` +
    '<div class="tl-ph" id="playhead"></div>';
  TLB.querySelectorAll('.kf,.seg').forEach((el: KfEl) => {
    const l = layerById(el.dataset.lid);
    el._k = (l.t[el.dataset.prop] || (l.ft && l.ft[el.dataset.prop]))[+el.dataset.i];
  });
  TLB.querySelectorAll('.sdot').forEach((el: KfEl) => {
    const l = layerById(el.dataset.lid),
      t = +el.dataset.t;
    el._ks = el.dataset.pose
      ? poseKeys(l, t)
      : Object.values(l.t).flatMap(tr => tr.filter(q => Math.abs(q[0] - t) < 0.004));
  });
  revealSelected();
  updatePlayhead();
}
/** what revealSelected() last saw: the selected layer, and whether it had a row */
let shown: { id: string | null; row: boolean } = { id: null, row: false };
/** When the selection changes (or the selected layer gets its first track), scroll the timeline so the
 *  layer's row and its property rows are in view, under the time ruler. Rows already in view stay put;
 *  the horizontal scroll is left alone. */
export function revealSelected() {
  const id = S.sel || null,
    row = id ? (TLB.querySelector(`.tl-layer[data-lid="${id}"]`) as HTMLElement | null) : null,
    changed = id !== shown.id || (!!row && !shown.row);
  shown = { id, row: !!row };
  if (!changed || !row) return;
  let last = row;
  for (
    let n = row.nextElementSibling as HTMLElement | null;
    n && n.dataset && n.dataset.lid === id && !n.classList.contains('tl-layer');
    n = n.nextElementSibling as HTMLElement | null
  )
    last = n;
  const ruler = TLB.querySelector('.tl-ruler') as HTMLElement | null,
    rh = ruler ? ruler.offsetHeight : 0,
    top = row.offsetTop,
    bot = last.offsetTop + last.offsetHeight,
    visTop = TLS.scrollTop + rh,
    visBot = TLS.scrollTop + TLS.clientHeight;
  if (top < visTop) TLS.scrollTop = top - rh;
  else if (bot > visBot) TLS.scrollTop = Math.min(top - rh, bot - TLS.clientHeight);
}
export function updatePlayhead() {
  updateGraphValues();
  const ph = $('#playhead');
  if (!ph) return;
  const x = tln() + S.time * S.pps;
  ph.style.left = x + 'px';
  ph.dataset.t = S.time.toFixed(2) + 's';
  // near the start the time flag hangs right of the line instead of centring on it
  ph.classList.toggle('at-start', S.time * S.pps - TLS.scrollLeft < 24);
  ph.style.visibility = x - TLS.scrollLeft < tln() - 1 ? 'hidden' : 'visible';
  const end = $('#tlEnd');
  if (end) end.style.visibility = tln() + doc.dur * S.pps - TLS.scrollLeft < tln() - 1 ? 'hidden' : 'visible';
  TLB.querySelectorAll('.tl-prop').forEach((r: HTMLElement) => {
    const l = layerById(r.dataset.lid),
      tr = l && l.t[r.dataset.prop];
    const b = r.querySelector('.kb');
    if (b && tr) {
      b.classList.add('has');
      b.classList.toggle(
        'on',
        tr.some(q => Math.abs(q[0] - S.time) < 0.005),
      );
    }
  });
  if (S.playing) {
    const vx = x - TLS.scrollLeft;
    if (vx > TLS.clientWidth - 30) TLS.scrollLeft = x - tln() - 20;
    else if (vx < tln()) TLS.scrollLeft = Math.max(0, x - tln() - 20);
  }
}
/** Drag the end line: the animation length follows (snapped to 0.05s; Shift for 0.01s). */
function endDrag(e0: PointerEvent) {
  const ed = beginEdit(),
    ruler = $('#ruler'),
    x0 = ruler.getBoundingClientRect().left;
  let tip = $('#tlEndTip');
  const show = () => {
    tip = $('#tlEndTip');
    if (tip) {
      tip.hidden = false;
      tip.textContent = '⏱ ' + tc(doc.dur);
    }
    const n = $('#tDur');
    if (n) n.value = clock(doc.dur);
  };
  show();
  dragWin(
    ev => {
      const raw = (ev.clientX - x0) / S.pps,
        st = ev.shiftKey ? 0.01 : 0.05,
        v = clamp(Math.round(raw / st) * st, 0.1, 600);
      if (Math.abs(v - doc.dur) < 1e-6) return;
      doc.dur = r3(v);
      if (S.time > doc.dur) S.time = doc.dur;
      renderTimeline();
      $('#tlEnd').classList.add('drag');
      show();
      frame();
    },
    () => {
      ed.end({ insp: true });
    },
  );
  void e0;
}
export function laneTime(e: { clientX: number }, lane: Element) {
  const r = lane.getBoundingClientRect();
  return clamp((e.clientX - r.left) / S.pps, 0, doc.dur);
}
export function dragWin(move: (e: PointerEvent) => void, up?: (e: PointerEvent) => void) {
  const mv = (e: PointerEvent) => move(e),
    u = (e: PointerEvent) => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', u);
      window.removeEventListener('pointercancel', u);
      if (up) up(e);
    };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', u);
  window.addEventListener('pointercancel', u);
}
export function selectKeyLayer(id: string) {
  if (S.sel !== id) {
    S.sel = id;
    // a layer of a multi-selection keeps the others selected
    if (!S.selSet.has(id)) S.selSet = new Set<string>([id]);
    S.node = null;
  }
}
/** Timeline keyframe element with the keyframe(s) it stands for. */
export type KfEl = HTMLElement & { _k?: Keyframe; _ks?: Keyframe[] };
export interface KeyOwner {
  l: Layer;
  k: PropKey;
  tr: Keyframe[];
}
export function keyOwners(): Map<Keyframe, KeyOwner> {
  const m = new Map<Keyframe, KeyOwner>();
  doc.layers.forEach(l => {
    for (const k in l.t) (l.t[k] || []).forEach(q => m.set(q, { l, k: k as PropKey, tr: l.t[k] }));
  });
  return m;
}
export const FRAME = 1 / 30;
export function snapT(t: number, excl: Set<Keyframe>) {
  let best: number | null = null,
    bd = 7 / S.pps;
  const cand = [S.time, 0, doc.dur];
  doc.layers.forEach(l => {
    for (const k in l.t)
      l.t[k].forEach(q => {
        if (!excl.has(q)) cand.push(q[0]);
      });
  });
  cand.forEach(c => {
    const d = Math.abs(c - t);
    if (d < bd) {
      bd = d;
      best = c;
    }
  });
  return best != null ? best : Math.round(t * 20) / 20;
}
export const TIP = $('#tltip');
export const MARQ = $('#tlmarq');
export const MENU: any = $('#ctxmenu');
export function showTip(ev: { clientX: number; clientY: number }, txt: string) {
  TIP.textContent = txt;
  TIP.hidden = false;
  TIP.style.left = Math.min(ev.clientX + 14, innerWidth - 200) + 'px';
  TIP.style.top = Math.max(4, ev.clientY - 32) + 'px';
}
export function resolveCollisions() {
  doc.layers.forEach(l => {
    for (const k in l.t) {
      const tr = l.t[k];
      sortTrack(tr);
      for (let i = tr.length - 1; i > 0; i--) {
        if (Math.abs(tr[i][0] - tr[i - 1][0]) < 0.004) {
          const drop = S.keys.has(tr[i]) && !S.keys.has(tr[i - 1]) ? i - 1 : i;
          S.keys.delete(tr[drop]);
          tr.splice(drop, 1);
        }
      }
    }
  });
}
export function keyDrag(e: PointerEvent, grab: Keyframe) {
  const x0 = e.clientX,
    dupMode = e.ctrlKey || e.metaKey,
    ed = beginEdit();
  let moved = false,
    items: Array<{ q: Keyframe; t0: number }> | null = null,
    g = grab,
    gT0 = grab[0],
    tMin = 0,
    tMax = 0,
    anchor = 0;
  dragWin(
    ev => {
      const dx = ev.clientX - x0;
      if (!moved) {
        if (Math.abs(dx) < 3) return;
        moved = true;
        if (dupMode) {
          const ow = keyOwners(),
            ns = new Set<any>();
          [...S.keys].forEach(q => {
            const o = ow.get(q);
            if (!o) return;
            const c = clone(q);
            o.tr.push(c);
            ns.add(c);
            if (q === g) g = c;
          });
          S.keys = ns;
          renderTimeline();
        }
        items = [...S.keys].map(q => ({ q, t0: q[0] }));
        const ts = items.map(i => i.t0);
        tMin = Math.min(...ts);
        tMax = Math.max(...ts);
        gT0 = g[0];
        anchor = Math.abs(gT0 - tMin) < 1e-6 && tMax > tMin ? tMax : tMin;
      }
      const snap = VIEW.sKeys !== ev.shiftKey;
      let tg = gT0 + dx / S.pps;
      tg = snap ? snapT(tg, S.keys) : Math.round(tg * 100) / 100;
      if (ev.altKey && tMax > tMin && Math.abs(gT0 - anchor) > 1e-6) {
        let f = (tg - anchor) / (gT0 - anchor);
        if (!isFinite(f)) f = 1;
        f = Math.max(0.02, f);
        items.forEach(i => {
          i.q[0] = r3(clamp(anchor + (i.t0 - anchor) * f, 0, doc.dur));
        });
        showTip(ev, `Stretch ×${f.toFixed(2)} · span ${fmt((tMax - tMin) * f)}s`);
      } else {
        const d = clamp(tg - gT0, -tMin, doc.dur - tMax);
        items.forEach(i => {
          i.q[0] = r3(i.t0 + d);
        });
        showTip(
          ev,
          `${fmt(g[0])}s  ${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))}s${dupMode ? ' · copy' : ''}${snap ? '' : ' · free'}`,
        );
      }
      TLB.querySelectorAll('.kf').forEach((el: KfEl) => {
        el.style.left = el._k[0] * S.pps + 'px';
      });
      doc.layers.forEach(L => Object.values<any>(L.t).forEach(sortTrack));
      frame();
    },
    () => {
      TIP.hidden = true;
      if (moved) resolveCollisions();
      else {
        S.time = g[0];
        S.ptime = S.time;
      }
      doc.layers.forEach(L => Object.values<any>(L.t).forEach(sortTrack));
      ed.end({ insp: true });
    },
  );
}
export function marquee(e: PointerEvent, lane: HTMLElement) {
  const x0 = e.clientX,
    y0 = e.clientY,
    add = e.shiftKey || e.ctrlKey || e.metaKey,
    base = new Set<Keyframe>(add ? S.keys : []);
  let moved = false;
  const hit = (el: Element, L: number, T: number, R: number, B: number) => {
    const r = el.getBoundingClientRect();
    return r.right >= L && r.left <= R && r.bottom >= T && r.top <= B;
  };
  dragWin(
    ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      const L = Math.min(x0, ev.clientX),
        T = Math.min(y0, ev.clientY),
        R = Math.max(x0, ev.clientX),
        B = Math.max(y0, ev.clientY);
      Object.assign(MARQ.style, { left: L + 'px', top: T + 'px', width: R - L + 'px', height: B - T + 'px' });
      MARQ.hidden = false;
      const sel = new Set<Keyframe>(base);
      TLB.querySelectorAll('.kf').forEach((el: KfEl) => {
        if (hit(el, L, T, R, B)) sel.add(el._k);
      });
      TLB.querySelectorAll('.sdot').forEach((el: KfEl) => {
        if (hit(el, L, T, R, B)) el._ks.forEach(q => sel.add(q));
      });
      S.keys = sel;
      TLB.querySelectorAll('.kf').forEach((el: KfEl) => el.classList.toggle('sel', sel.has(el._k)));
      TLB.querySelectorAll('.sdot').forEach((el: KfEl) =>
        el.classList.toggle('sel', el._ks.length > 0 && el._ks.every(q => sel.has(q))),
      );
      showTip(ev, `${sel.size} keyframe${sel.size === 1 ? '' : 's'}`);
    },
    ev => {
      MARQ.hidden = true;
      TIP.hidden = true;
      if (!moved) {
        if (!add) S.keys.clear();
        const row = lane.closest<HTMLElement>('[data-lid]');
        if (row) selectKeyLayer(row.dataset.lid);
        S.time = clamp(r3(laneTime(ev, lane)), 0, doc.dur);
        S.ptime = S.time;
      } else {
        const ow = keyOwners(),
          first = [...S.keys][0];
        if (first && ow.get(first)) selectKeyLayer(ow.get(first).l.id);
      }
      renderLayers();
      renderTimeline();
      renderInspector();
      frame();
    },
  );
}

export function init(): void {
  TLS.addEventListener('scroll', () => updatePlayhead());
  // Ctrl+wheel (or a pinch) zooms the timeline around the pointer
  TLS.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = TLS.getBoundingClientRect(),
        x = e.clientX - r.left,
        t = (TLS.scrollLeft + x - tln()) / S.pps,
        z = $('#tZoom') as HTMLInputElement,
        pps = Math.round(clamp(S.pps * Math.exp(-e.deltaY * 0.0015), +z.min || 40, +z.max || 420));
      if (pps === S.pps) return;
      S.pps = pps;
      z.value = String(pps);
      z.dispatchEvent(new Event('input', { bubbles: true }));
      if (t >= 0) TLS.scrollLeft = Math.max(0, tln() + t * pps - x);
    },
    { passive: false },
  );
  // the shown range fills the panel, so redraw when the panel changes size
  let lastW = 0;
  if (typeof ResizeObserver !== 'undefined')
    new ResizeObserver(() => {
      if (Math.abs(TLS.clientWidth - lastW) < 2) return;
      lastW = TLS.clientWidth;
      if (doc) renderTimeline();
    }).observe(TLS);
  // keyboard: ←/→ on the focused end line change the length
  TLB.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!(e.target as any).closest || !(e.target as any).closest('#tlEnd')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const ed = beginEdit();
    doc.dur = r3(clamp(doc.dur + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 0.1), 0.1, 600));
    if (S.time > doc.dur) S.time = doc.dur;
    ed.end({ insp: true });
    const n = $('#tlEnd');
    if (n) n.focus();
  });
  TLB.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    closeMenu();
    const seg = (e.target as any).closest('.seg');
    if (seg) {
      e.preventDefault();
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) S.keys.clear();
      S.keys.add(seg._k);
      selectKeyLayer(seg.dataset.lid);
      renderLayers();
      renderTimeline();
      renderInspector();
      frame();
      return;
    }
    const kf = (e.target as any).closest('.kf, .sdot');
    if (kf) {
      e.preventDefault();
      const ks = kf._ks || [kf._k],
        allIn = ks.length > 0 && ks.every((q: Keyframe) => S.keys.has(q));
      if (e.shiftKey) {
        ks.forEach((q: Keyframe) => (allIn ? S.keys.delete(q) : S.keys.add(q)));
      } else if (!allIn) {
        if (!(e.ctrlKey || e.metaKey)) S.keys.clear();
        ks.forEach((q: Keyframe) => S.keys.add(q));
      }
      selectKeyLayer(kf.dataset.lid);
      if (kf.dataset.prop) focusProp(kf.dataset.prop);
      TLB.querySelectorAll('.kf').forEach((el: KfEl) => el.classList.toggle('sel', S.keys.has(el._k)));
      if (!S.keys.size || (e.shiftKey && allIn)) {
        renderTimeline();
        renderInspector();
        frame();
        return;
      }
      keyDrag(e, S.keys.has(ks[0]) ? ks[0] : [...S.keys][0]);
      return;
    }
    if ((e.target as any).closest('#tlEnd')) {
      e.preventDefault();
      return endDrag(e);
    }
    const ruler = (e.target as any).closest('#ruler');
    if (ruler) {
      e.preventDefault();
      setTime(laneTime(e, ruler));
      dragWin(ev => setTime(laneTime(ev, ruler)));
      return;
    }
    const lane = (e.target as any).closest('[data-act="lane"]');
    if (lane) {
      e.preventDefault();
      marquee(e, lane);
    }
  });
}
