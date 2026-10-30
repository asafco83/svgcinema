// SVGcinema — core/symbols
// Symbols: reusable artwork. A symbol's instances are groups marked with the symbol's id (`sym`); each
// instance has its own transform, opacity and keyframes (on the group), while its contents (shapes,
// styles and their animation) are shared: change them in one instance and every other instance follows.
// An instance can start the shared animation later (`symOff`, seconds). Under the hood every instance
// keeps its own copy of the contents; after each edit, the instance whose contents differ from the
// symbol's last known contents is copied to the others (keyframes shifted by the time offsets).
// The JS export writes one instance in full and the others as <use> of it (when they have the same
// offset); the CSS export writes every instance.
import { featureUsed } from './analytics';
import type { Layer } from '../model/types';
import { S, doc, layerById, mkLayer, uid } from './state';
import { NOFILL, clone } from './constants';
import { descendants } from '../model/tree';

export interface SymbolDef {
  name: string;
  /** the contents as last synced (see contentSig) */
  sig?: string;
}

export function symbols(): Record<string, SymbolDef> {
  return (doc.symbols = doc.symbols || {});
}
export const isInstance = (l: Layer | null | undefined) => !!(l && l.sym && symbols()[l.sym]);
export function instancesOf(id: string): Layer[] {
  return doc.layers.filter(l => l.sym === id);
}
/** the instance a layer sits in (itself when it is one), the innermost one */
export function instanceOf(l: Layer | null | undefined): Layer | null {
  let x = l,
    g = 0;
  while (x && g++ < 200) {
    if (isInstance(x)) return x;
    x = x.parent ? layerById(x.parent) : null;
  }
  return null;
}
/** an instance's contents, in document order */
const contents = (inst: Layer) => descendants(inst).sort((a, b) => doc.layers.indexOf(a) - doc.layers.indexOf(b));
/** the contents with ids replaced by their order and keyframe times taken back to offset 0, so that
 *  two instances with the same contents compare equal */
export function contentSig(inst: Layer): string {
  const list = contents(inst),
    idx: Record<string, string> = { [inst.id]: '@root' };
  list.forEach((l, i) => (idx[l.id] = '@' + i));
  const off = inst.symOff || 0;
  let s = JSON.stringify(
    list.map(l => {
      const c: any = clone(l);
      delete c.id;
      if (off) for (const k in c.t) c.t[k].forEach((q: any) => (q[0] = Math.round((q[0] - off) * 1000) / 1000));
      return c;
    }),
  );
  for (const id in idx) s = s.split(JSON.stringify(id)).join(JSON.stringify(idx[id]));
  return s;
}
/** Replace `to`'s contents with a copy of `from`'s (new ids, keyframes shifted by the offsets). */
export function copyContents(from: Layer, to: Layer) {
  const old = new Set(contents(to).map(l => l.id));
  const at = doc.layers.findIndex(l => old.has(l.id));
  doc.layers = doc.layers.filter(l => !old.has(l.id));
  const src = contents(from),
    map: Record<string, string> = { [from.id]: to.id };
  src.forEach(l => (map[l.id] = uid()));
  const dt = (to.symOff || 0) - (from.symOff || 0);
  let json = JSON.stringify(src);
  for (const id in map) json = json.split(JSON.stringify(id)).join(JSON.stringify(map[id]));
  const copies: Layer[] = JSON.parse(json);
  if (dt)
    copies.forEach(l =>
      Object.values(l.t).forEach(tr => tr.forEach(q => (q[0] = Math.round((q[0] + dt) * 1000) / 1000))),
    );
  // selection inside the target follows the copies
  const pos = at >= 0 ? Math.min(at, doc.layers.length) : doc.layers.indexOf(to) + 1;
  doc.layers.splice(pos, 0, ...copies);
}
/** After an edit: carry changed contents to the other instances of the same symbol. Returns true when
 *  something was copied. `prefer`: the instance being edited wins when several changed. */
export function syncSymbols(prefer?: string | null): boolean {
  const defs = symbols();
  let changed = false;
  for (const id in defs) {
    const list = instancesOf(id);
    if (!list.length) continue;
    const sigs = list.map(contentSig),
      known = defs[id].sig;
    let src = -1;
    if (known == null) src = 0;
    else {
      const p = prefer ? list.findIndex(l => l.id === prefer) : -1;
      if (p >= 0 && sigs[p] !== known) src = p;
      else src = sigs.findIndex(s => s !== known);
    }
    if (src < 0) continue;
    const from = list[src];
    list.forEach((to, i) => {
      if (i !== src && sigs[i] !== sigs[src]) {
        copyContents(from, to);
        changed = true;
      }
    });
    defs[id].sig = sigs[src];
  }
  // symbols with no instances left are kept (they list in Assets until deleted there)
  return changed;
}
/** Element ▸ Make symbol: the selected group (or a new group of the selected layers) becomes a symbol's
 *  first instance. Expects to run inside an edit. */
export function makeSymbol(g: Layer, name?: string): string {
  featureUsed('symbol');
  const defs = symbols();
  let n = Object.keys(defs).length + 1,
    id = 'sym' + n;
  while (defs[id]) id = 'sym' + ++n;
  defs[id] = { name: name || g.name || 'Symbol ' + n };
  g.sym = id;
  delete g.symOff;
  defs[id].sig = contentSig(g);
  return id;
}
/** Detach instance: it becomes a plain group (its contents stay as they are). */
export function detach(l: Layer) {
  delete l.sym;
  delete l.symOff;
}
/** Change an instance's time offset: its contents' keyframes move with it. */
export function setOffset(l: Layer, off: number) {
  const dt = off - (l.symOff || 0);
  if (!dt) return;
  contents(l).forEach(c =>
    Object.values(c.t).forEach(tr => tr.forEach(q => (q[0] = Math.round((q[0] + dt) * 1000) / 1000))),
  );
  if (off) l.symOff = off;
  else delete l.symOff;
}
/** A new instance of a symbol: a copy of its first instance, placed `dx, dy` from it, at the top. */
export function addInstance(id: string, dx = 24, dy = 24): Layer | null {
  const src = instancesOf(id)[0];
  if (!src) return null;
  const inst = mkLayer('group', symbols()[id].name, {}, NOFILL);
  Object.assign(inst, clone({ ...src, id: inst.id, parent: null, hid: false, sym: id }));
  delete inst.symOff;
  inst.t = {};
  const p = (src.b.pos as number[]) || [0, 0];
  inst.b.pos = [p[0] + dx, p[1] + dy];
  doc.layers.push(inst);
  copyContents(src, inst);
  return inst;
}
/** Delete a symbol: its instances become plain groups. */
export function deleteSymbol(id: string) {
  instancesOf(id).forEach(detach);
  delete symbols()[id];
}
export function renameSymbol(id: string, name: string) {
  const d = symbols()[id];
  if (d && name.trim()) d.name = name.trim();
}
/** an instance in the inspector or layers panel: "×N" */
export const instanceCount = (id: string) => instancesOf(id).length;
/** used by tests: the editing state's instance, if any */
export const editingSymbol = () => (S.symEdit ? layerById(S.symEdit) : null);
