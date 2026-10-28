// SVGcinema — core/state
import { H, SWATCH } from './constants';
import type { CinPlayer } from '../runtime/engine';
import type { Asset, Doc, EditorState, Keyframe, Layer, LayerType, Geometry, BaseValues } from '../model/types';
import { dropKeys } from './plain-path';

export let doc: Doc;
export let eng: CinPlayer;
export function setDoc(d: Doc) {
  doc = d;
}
export function setEng(e: CinPlayer) {
  eng = e;
}
export const ASSETS: Record<string, Asset> = {};
export const URLS: Record<string, string> = {};
export const S: EditorState = {
  sel: null,
  selSet: new Set<string>(),
  tool: 'select',
  time: 0,
  ptime: 0,
  playing: false,
  loop: true,
  pps: 140,
  zoom: 1,
  scale: 1,
  exp: {},
  lexp: {},
  keys: new Set<Keyframe>(),
  node: null,
  undo: [],
  redo: [],
  drag: null,
  pen: null,
  last: 0,
  colorEd: null,
  swatch: 0,
  lockAR: true,
  ezDir: 'inOut',
  tab: 'layers',
  clip: null,
  showBones: true,
  showPins: true,
  bindPins: [],
  boneDraft: null,
  bindPick: [],
  bindHover: null,
  bindPt: null,
  bindScreen: null,
  boneScaleMode: 'length',
  boneVolume: 'area',
  pinSel: null,
  pinRing: null,
  pinBind: false,
  pinBoneHover: null,
  pan: { x: 0, y: 0 },
  toolGroup: { pen: 'pen', shapes: 'rect' },
  polySides: 6,
  starPoints: 5,
};
export let idc = 0;
export let aidc = 0;
export function setIdc(v: number) {
  idc = v;
}
export function nextAid() {
  return 'a' + ++aidc;
}
export function uid() {
  return 'l' + ++idc;
}
export function syncIdc() {
  idc = doc.layers.reduce((m: number, l) => Math.max(m, parseInt(String(l.id).slice(1)) || 0), 0);
}
export function syncAidc() {
  aidc = Object.keys(ASSETS).reduce((m: number, k) => Math.max(m, parseInt(k.slice(1)) || 0), 0);
}
export function layerById(id: string | null | undefined): Layer | undefined {
  return doc && doc.layers.find(l => l.id === id);
}
// the editor's composites find parent bones by id (child bones cancel their parent's scale)
H.lookup(id => layerById(id));
dropKeys.fn = q => S.keys.delete(q as any);
export function selLayer(): Layer | null | undefined {
  return S.sel ? layerById(S.sel) : null;
}
export function nextColor() {
  return SWATCH[S.swatch++ % SWATCH.length];
}
export function randPre() {
  return 'cin' + Math.random().toString(36).slice(2, 6);
}
export function blankDoc(w: number, h: number): Doc {
  return {
    name: 'Untitled animation',
    w,
    h,
    vx: 0,
    vy: 0,
    bg: '#FFFFFF',
    bgA: 1,
    dur: 3,
    it: 0,
    dir: 'normal',
    defs: '',
    layers: [],
    ezPresets: [],
    ex: {
      mode: 'js',
      trigger: 'load',
      out: 'pause',
      size: 'resp',
      ids: 'gen',
      fill: 'forwards',
      speed: 1,
      fps: 0,
      prefix: randPre(),
      w: 0,
      h: 0,
      lock: true,
      maxW: 0,
      opt: true,
      fmt: 'auto',
      q: 82,
      hi: true,
    },
  };
}
export function mkLayer(type: LayerType, name: string, geo?: Geometry, b?: Partial<BaseValues>): Layer {
  return {
    id: uid(),
    name,
    type,
    parent: null,
    geo: geo || {},
    b: Object.assign({ pos: [0, 0], rot: 0, scl: [1, 1], op: 1, fill: '#5B7CFA', stk: 'none', sw: 0 }, b || {}),
    t: {},
    o: null,
    sm: false,
    or: false,
    hid: false,
    lock: false,
    xf: '',
    extra: {},
  };
}
export function sortTrack(tr: Keyframe[]) {
  tr.sort((a, b) => a[0] - b[0]);
}
