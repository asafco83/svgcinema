// SVGcinema — ui/easing
import type { Ease } from '../model/types';
import { $, EZFAM, H, clamp, clone, esc, fmt, r2, r3 } from '../core/constants';
import { beginEdit } from '../core/history';
import { S, doc } from '../core/state';

export function easeLabel(e: Ease): string {
  if (Array.isArray(e)) return 'cubic-bezier(' + e.map(v => r3(v)).join(', ') + ')';
  const m: Record<string, string> = {
    linear: 'Linear',
    ease: 'Ease',
    in: 'Ease in',
    out: 'Ease out',
    inOut: 'Ease in-out',
    hold: 'Hold',
  };
  if (!e) return 'Ease';
  if (m[e]) return m[e];
  const q = /^(inOut|in|out)([A-Z]\w*)$/.exec(e);
  if (q) return q[2] + ' ' + (<Record<string, string>>{ in: 'in', out: 'out', inOut: 'in-out' })[q[1]];
  return e;
}
export function easeDir(e: Ease): string {
  if (typeof e !== 'string') return S.ezDir;
  if (e === 'in' || e === 'out' || e === 'inOut') return e;
  const q = /^(inOut|in|out)[A-Z]/.exec(e);
  return q ? q[1] : S.ezDir;
}
export function easeFam(e: Ease): string {
  if (Array.isArray(e)) return 'custom';
  if (e === 'in' || e === 'out' || e === 'inOut') return 'Standard';
  const q = /^(?:inOut|in|out)([A-Z]\w*)$/.exec(e || '');
  return q ? q[1] : e || 'ease';
}
export function famName(f: string, dir: string) {
  return f === 'Standard' ? dir : dir + f;
}
export function bezOf(e: Ease): number[] | null {
  return Array.isArray(e) ? e : !e ? H.EZ.ease : e === 'linear' ? [0, 0, 1, 1] : H.EZ[e] || null;
}
export function sameEase(a: Ease, b: Ease) {
  return JSON.stringify(a || 'ease') === JSON.stringify(b || 'ease');
}
export function thumb(e: Ease) {
  let d = '';
  for (let i = 0; i <= 40; i++) {
    const p = i / 40,
      v = clamp(H.ease(e, p), -0.45, 1.45);
    d += (i ? 'L' : 'M') + r2(3 + p * 34) + ' ' + r2(21 - v * 16);
  }
  return `<svg viewBox="0 -2 40 30" aria-hidden="true"><path d="${d}"/></svg>`;
}
/* the curve editor: 160 × 176, time across, the value up (a little room for overshoot, -0.12…1.12) */
export const EZW = 160,
  EZH = 176;
export function EZX(x: number) {
  return 12 + x * (EZW - 24);
}
export function EZY(v: number) {
  return EZH - 14 - ((v + 0.12) * (EZH - 28)) / 1.24;
}
/** a point of the editor back to time and value */
export function EZXi(px: number) {
  return (px - 12) / (EZW - 24);
}
export function EZYi(py: number) {
  return ((EZH - 14 - py) * 1.24) / (EZH - 28) - 0.12;
}
/** The Easing panel (timeline header): the selected keyframes' easing to the next key. */
export function keyPanel() {
  const ks = [...S.keys],
    k0 = ks[0],
    cur = k0[2] || 'ease';
  S.ezDir = easeDir(cur);
  const allSame = ks.every(k => sameEase(k[2], cur)),
    dir = S.ezDir;
  const tile = (e: Ease, label: string, extra?: string) =>
    `<button class="ezb${allSame && sameEase(e, cur) ? ' on' : ''}" data-ez="${esc(JSON.stringify(e))}" title="${esc(easeLabel(e))}" aria-pressed="${allSame && sameEase(e, cur)}"${extra || ''}>${thumb(e)}<span>${esc(label)}</span></button>`;
  let grid = tile('linear', 'Linear') + tile('ease', 'Ease') + tile('hold', 'Hold');
  EZFAM.forEach(f => {
    grid += tile(famName(f, dir), f === 'Standard' ? 'Basic' : f);
  });
  const pre = doc.ezPresets || [];
  pre.forEach((p, i) => {
    grid += tile(p.v, p.name, ` data-ezp="${i}"`);
  });
  const isPreset = pre.some(p => sameEase(p.v, cur));
  if (Array.isArray(cur) && !isPreset)
    grid += `<button class="ezb on" data-ez="${esc(JSON.stringify(cur))}" title="${esc(easeLabel(cur))}" aria-pressed="true">${thumb(cur)}<span>Custom</span></button>`;
  const lines = [0, 1]
    .map(v => `<line class="gb" x1="${EZX(0)}" x2="${EZX(1)}" y1="${EZY(v)}" y2="${EZY(v)}"/>`)
    .join('');
  return `<section id="kfsec" class="ezpn">
    <div class="ezpn-h"><b>${ks.length > 1 ? `${ks.length} keyframes` : 'Keyframe'}</b><small>easing to the next key</small>${
      ks.length === 1
        ? `<label class="nf ezpn-t" title="The keyframe's time"><span>t</span><input id="kf-time" inputmode="decimal" value="${fmt(k0[0])}" aria-label="Keyframe time"><em>s</em></label>`
        : ''
    }</div>
    <div class="ezpn-b"><div class="ezpn-l">
      <div class="segc" id="ezDir" role="radiogroup" aria-label="Direction">${[
        ['in', 'In'],
        ['out', 'Out'],
        ['inOut', 'In-Out'],
      ]
        .map(
          d =>
            `<button data-v="${d[0]}" class="${dir === d[0] ? 'on' : ''}" role="radio" aria-checked="${dir === d[0]}">${d[1]}</button>`,
        )
        .join('')}</div>
      <div class="ezfam" id="ezGrid">${grid}</div></div>
    <div class="ezpn-r"><svg class="ezed" id="ezEd" width="${EZW}" height="${EZH}" viewBox="0 0 ${EZW} ${EZH}" role="img" aria-label="Easing curve editor. Drag the two handles to make a custom curve.">${lines}
      <text x="${EZW - 12}" y="${EZH - 3}" text-anchor="end">time</text>
      <line class="arm" id="ezA0"/><line class="arm" id="ezA1"/><path class="cv" id="ezCurve"/>
      <circle class="end" cx="${EZX(0)}" cy="${EZY(0)}" r="2.5"/><circle class="end" cx="${EZX(1)}" cy="${EZY(1)}" r="2.5"/>
      <circle class="hd" id="ezH0" data-hd="0" r="5"/><circle class="hd" id="ezH1" data-hd="1" r="5"/></svg>
      ${Array.isArray(cur) && !isPreset ? '<button class="btn" data-act="ezsave">Save as preset</button>' : ''}
      ${isPreset ? '<button class="btn" data-act="ezdelp">Remove preset</button>' : ''}
      <button class="btn" data-act="ezall">Use on whole animator</button><button class="btn danger" data-act="kdel">Delete key${ks.length > 1 ? 's' : ''}</button></div></div></section>`;
}
export function drawEz() {
  const k0 = [...S.keys][0];
  if (!k0 || !$('#ezEd')) return;
  const e = k0[2] || 'ease',
    bz = bezOf(e);
  let d = '';
  for (let i = 0; i <= 100; i++) {
    const p = i / 100;
    d += (i ? 'L' : 'M') + r2(EZX(p)) + ' ' + r2(EZY(clamp(H.ease(e, p), -0.16, 1.16)));
  }
  $('#ezCurve').setAttribute('d', d);
  const b = bz || [0.25, 0.1, 0.25, 1],
    P1 = [EZX(b[0]), EZY(b[1])],
    P2 = [EZX(b[2]), EZY(b[3])];
  const A0 = $('#ezA0'),
    A1 = $('#ezA1'),
    H0 = $('#ezH0'),
    H1 = $('#ezH1');
  [
    ['x1', EZX(0)],
    ['y1', EZY(0)],
    ['x2', P1[0]],
    ['y2', P1[1]],
  ].forEach(([k, v]) => A0.setAttribute(k, v));
  [
    ['x1', EZX(1)],
    ['y1', EZY(1)],
    ['x2', P2[0]],
    ['y2', P2[1]],
  ].forEach(([k, v]) => A1.setAttribute(k, v));
  H0.setAttribute('cx', P1[0]);
  H0.setAttribute('cy', P1[1]);
  H1.setAttribute('cx', P2[0]);
  H1.setAttribute('cy', P2[1]);
  [A0, A1, H0, H1].forEach(x => x.classList.toggle('dim', !bz));
}
export function applyEase(v: Ease) {
  const ed = beginEdit();
  S.keys.forEach(k => (k[2] = clone(v)));
  ed.end({ insp: true });
}
export const CSSKW: Record<string, number[]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};
export function parseBez(raw: unknown): number[] | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (CSSKW[s]) return CSSKW[s].slice();
  const n = (s.match(/-?\d*\.?\d+(e-?\d+)?/g) || []).map(parseFloat);
  if (n.length !== 4 || !n.every(isFinite)) return null;
  n[0] = clamp(n[0], 0, 1);
  n[2] = clamp(n[2], 0, 1);
  n[1] = clamp(n[1], -2, 3);
  n[3] = clamp(n[3], -2, 3);
  return n.map(r3);
}
