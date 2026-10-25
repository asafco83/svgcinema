// SVGcinema — io/batch
// Two small bridges for the batch converter (tools/convert.html), which is not part of the editor's
// own interface:
// - index.html?batch (in a hidden frame of the converter): `window.cinBatch.convert()` opens one SVG
//   exactly as Open does and saves it exactly as Save does (layers, keyframes, the first-frame
//   thumbnail), without keeping anything in this browser (core/batch-mode).
// - index.html?receive (opened by the converter's "Open in editor"): takes one project file from the
//   window that opened it and opens it, asking first if the current project has unsaved changes.
import { ASSETS, doc } from '../core/state';
import { BATCH } from '../core/batch-mode';
import { fileName } from '../export/images';
import { confirmDiscard } from './guard';
import { loadProjectFile } from './open';
import { buildProject, makeZip, readZip } from './zip';
import { THUMB_NAME } from './thumbnail';

export interface BatchResult {
  ok: boolean;
  /** the project's file name without the extension */
  base?: string;
  project?: Blob;
  /** the first-frame thumbnail, as a data URL */
  thumb?: string;
  layers?: number;
  animated?: number;
  dur?: number;
  /** 0 = loops forever, else the number of plays */
  it?: number;
  images?: number;
  /** what the import couldn't bring across */
  notes?: string[];
  error?: string;
}

function why(text: string) {
  if (!/<svg[\s>]/i.test(text)) return 'The file isn’t an SVG.';
  if (!/<\/svg>\s*(<!--[\s\S]*?-->\s*)*$/i.test(text.trim())) return 'The file isn’t a complete SVG (it ends early).';
  return 'The file isn’t valid SVG markup.';
}
const toData = (u8: Uint8Array) =>
  new Promise<string>(res => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsDataURL(new Blob([u8], { type: 'image/png' }));
  });

/** Convert one SVG. `titleNames`: name the project after the SVG's title when it has one. */
export async function convert(name: string, text: string, titleNames = true): Promise<BatchResult> {
  const base = name.replace(/\.svg$/i, '');
  try {
    const sv = await import('./svg-import');
    if (!sv.parseSVG(text)) return { ok: false, error: why(text) };
    const ok = await sv.importSVGWith(text, { project: true, name: base });
    if (!ok) return { ok: false, error: why(text) };
    if (!titleNames) doc.name = base;
    const blob = await buildProject(false),
      z = await readZip(await blob.arrayBuffer()),
      png = await z.get(THUMB_NAME);
    return {
      ok: true,
      base: titleNames ? fileName(doc.name, base) : base,
      project: blob,
      thumb: png ? await toData(png) : '',
      layers: doc.layers.length,
      animated: doc.layers.filter(l => Object.keys(l.t || {}).some(k => l.t[k] && l.t[k].length)).length,
      dur: doc.dur,
      it: doc.it || 0,
      images: Object.keys(ASSETS).length,
      notes: sv.lastImportNotes.slice(),
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'The file couldn’t be converted.' };
  }
}
/** Pack finished projects into one zip (the converter's "One .zip download"). */
export function zipAll(files: Array<{ name: string; blob: Blob }>) {
  return Promise.all(files.map(async f => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) }))).then(
    makeZip,
  );
}

export function initBatch() {
  if (BATCH) {
    (window as any).cinBatch = { convert, zipAll };
    try {
      window.parent.postMessage({ type: 'cin-batch-ready' }, location.origin);
    } catch (_) {}
  }
  if (/[?&]receive(=|&|$)/.test(location.search) && window.opener) {
    window.addEventListener('message', async (e: MessageEvent) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'cin-open') return;
      if (!(await confirmDiscard('Opening another project closes this one. Save your changes first?'))) return;
      await loadProjectFile(new File([e.data.blob], e.data.name), null);
      history.replaceState(null, '', location.pathname);
    });
    window.opener.postMessage({ type: 'cin-receive-ready' }, location.origin);
  }
}
