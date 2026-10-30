// SVGcinema — io/open
import { track } from '../core/analytics';
import { fitView, zoomAt } from '../tools/hand';
import type { Asset, BaseValues, Doc, Layer, OpenFile } from '../model/types';
import { $, clamp, clock } from '../core/constants';
import { syncFa } from '../model/filters';
import { redo, save, setTime, undo } from '../core/history';
import { togglePlay } from '../core/playback';
import { ASSETS, S, URLS, blankDoc, doc, setDoc, syncAidc } from '../core/state';
import { assetURL, blobToData, saveAssets } from './assets';
import { markClean, persistFile, updateFileInfo } from './file-state';
import { confirmDiscard } from './guard';
import { readZip } from './zip';
import { readExtras, resetExtras } from './extras';
import { addRecent } from './recent';
import { artLabel, fit, frame } from '../render/stage';
import { docField } from '../ui/inspector';
import { renderTimeline } from '../ui/timeline';
import { resetView } from '../ui/topbar';

export function clearAssets() {
  Object.keys(ASSETS).forEach(id => {
    try {
      URL.revokeObjectURL(URLS[id]);
    } catch (_) {}
    delete URLS[id];
    delete ASSETS[id];
  });
}
export function applyProject(d: Partial<Doc>, assets: Record<string, Asset> | null, file: OpenFile | null) {
  S.loading = true;
  clearAssets();
  Object.values(assets || {}).forEach(a => {
    if (!a || !a.id) return;
    ASSETS[a.id] = a;
    try {
      URLS[a.id] = assetURL(a);
    } catch (_) {
      URLS[a.id] = a.data;
    }
  });
  syncAidc();
  saveAssets();
  setDoc(normalizeDoc(d));
  // what belonged to the old project (the agent's chat) goes with it
  resetExtras();
  S.undo = [];
  S.redo = [];
  S.file = file;
  persistFile();
  resetView();
  S.loading = false;
  markClean();
}
export async function loadProjectFile(f: File, handle: FileSystemFileHandle | null) {
  try {
    const buf = await f.arrayBuffer(),
      u8 = new Uint8Array(buf);
    // an SVG (or animated SVG) opens as a new project made from it
    if (
      /\.svg$/i.test(f.name) ||
      f.type === 'image/svg+xml' ||
      /^\s*(<\?xml|<svg|<!--)/.test(new TextDecoder().decode(u8.slice(0, 64)))
    ) {
      const { importSVG } = await import('./svg-import');
      return await importSVG(new TextDecoder().decode(u8), true, f.name.replace(/\.svg$/i, ''));
    }
    if (u8[0] === 0x50 && u8[1] === 0x4b) {
      const z = await readZip(buf),
        man = JSON.parse((await z.text('manifest.json')) || '{}');
      if (man.format !== 'svgcinema-project') throw new Error('it isn’t an SVGcinema project');
      const d = JSON.parse(await z.text('project.json')),
        idx = JSON.parse((await z.text('assets/index.json')) || '[]'),
        assets: Record<string, Asset> = {},
        dec = new TextDecoder();
      for (const a of idx) {
        const bytes = await z.get(a.file);
        if (!bytes) continue;
        const o = Object.assign({}, a);
        delete o.file;
        if (a.kind === 'svg') {
          o.text = dec.decode(bytes);
          o.data = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(o.text);
        } else o.data = await blobToData(new Blob([bytes], { type: a.mime || 'application/octet-stream' }));
        assets[a.id] = o;
      }
      applyProject(d, assets, { name: f.name, handle: handle || null });
      track('project_open', { kind: 'svgcinema' });
      await readExtras(z);
      addRecent(f.name, handle || null, handle ? null : f);
      const missing = idx.length - Object.keys(assets).length;
      toast(`Opened ${f.name}${missing ? ` (${missing} image${missing > 1 ? 's' : ''} missing)` : ''}.`);
      return true;
    }
    const d = JSON.parse(new TextDecoder().decode(u8)),
      dd = d && d.format === 'svgcinema' ? d.doc : d;
    if (!dd || !Array.isArray(dd.layers)) throw new Error('it isn’t an SVGcinema project');
    applyProject(dd, d.assets || {}, null);
    track('project_open', { kind: 'svgcinema_json' });
    S.dirty = true;
    updateFileInfo();
    toast('Opened an older project file. Use Save to keep it as .SVGcinema.');
    return true;
  } catch (e) {
    toast(`Couldn’t open ${f.name}: ${(e && e.message) || 'it isn’t an SVGcinema project'}.`);
    return false;
  }
}
export async function openFlow() {
  if (!(await confirmDiscard('Opening another project closes this one. Save your changes first?'))) return;
  if (typeof (window as any).showOpenFilePicker === 'function') {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: 'SVGcinema project or SVG',
            accept: {
              'application/x-svgcinema-project': ['.SVGcinema'],
              'application/zip': ['.zip'],
              'application/json': ['.json'],
              'image/svg+xml': ['.svg'],
            },
          },
        ],
        id: 'svgcinema',
        multiple: false,
      });
      const f = await handle.getFile();
      await loadProjectFile(f, /\.svgcinema$/i.test(f.name) ? handle : null);
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  $('#fProj').click();
}
export function openProject(t: string) {
  loadProjectFile(new File([t], 'project.json', { type: 'application/json' }), null);
}
export function normalizeDoc(d: Partial<Doc>): Doc {
  const o = Object.assign(blankDoc(d.w || 640, d.h || 400), d);
  o.ex = Object.assign(blankDoc(1, 1).ex, d.ex || {});
  o.ezPresets = d.ezPresets || [];
  const ids = new Set<string>(o.layers.map((l: Layer) => l.id));
  o.layers.forEach((l: Layer) => {
    l.t = l.t || {};
    l.b = Object.assign({ pos: [0, 0], rot: 0, scl: [1, 1], op: 1 } as BaseValues, l.b || {});
    l.extra = l.extra || {};
    l.geo = l.geo || {};
    if (!l.parent || !ids.has(l.parent) || l.parent === l.id) l.parent = null;
    // the runtime's filter map follows the filter chains (they gained steps over time)
    if (l.fx && l.fx.length) syncFa(l);
  });
  return o;
}
export let toastT: ReturnType<typeof setTimeout> | 0 = 0;
/** A short message at the bottom. With `act`, it carries a button (e.g. Undo) and stays a little longer. */
export function toast(m: string, act?: { label: string; run: () => void }, ms?: number) {
  const t = $('#toast');
  t.textContent = m;
  if (act) {
    const b = document.createElement('button');
    b.className = 'toast-act';
    b.textContent = act.label;
    b.addEventListener('click', () => {
      t.hidden = true;
      act.run();
    });
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), ms || (act ? 6000 : 3000));
}

export function init(): void {
  $('#bOpen').addEventListener('click', openFlow);
  $('#fProj').addEventListener('change', (e: Event) => {
    const f = (e.target as any).files[0];
    (e.target as any).value = '';
    if (f) loadProjectFile(f, null);
  });
  $('#bUndo').addEventListener('click', undo);
  $('#bRedo').addEventListener('click', redo);
  $('#pname').addEventListener('change', (e: Event) => {
    doc.name = (e.target as any).value.trim() || 'Untitled animation';
    artLabel();
    save();
  });
  $('#pname').addEventListener('input', (e: Event) => artLabel((e.target as any).value.trim()));
  $('#tPlay').addEventListener('click', togglePlay);
  $('#tStart').addEventListener('click', () => {
    setTime(0);
  });
  $('#tLoop').addEventListener('click', (e: MouseEvent) => {
    S.loop = !S.loop;
    (e.currentTarget as HTMLElement).classList.toggle('on', S.loop);
  });
  // the length field (the total after the time): seconds or a time; Enter applies, Esc puts it back
  const td = $('#tDur') as HTMLInputElement;
  td.addEventListener('change', () => {
    docField(td);
    td.value = clock(doc.dur);
  });
  td.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') td.blur();
    else if (e.key === 'Escape') {
      td.value = clock(doc.dur);
      td.blur();
    }
  });
  $('#tZoom').addEventListener('input', (e: Event) => {
    S.pps = +(e.target as any).value;
    renderTimeline();
  });
  $('#zIn').addEventListener('click', () => zoomAt(1.25));
  $('#zOut').addEventListener('click', () => zoomAt(1 / 1.25));
}
