// SVGcinema — io/assets
import type { Asset } from '../model/types';
import { $, ICON, NOFILL, esc, r2 } from '../core/constants';
import { AG } from '../core/dom';
import { BATCH } from '../core/batch-mode';
import { beginEdit } from '../core/history';
import { ASSETS, S, URLS, doc, mkLayer, nextAid } from '../core/state';
import { markDirty } from './file-state';
import { confirmDiscard } from './guard';
import { loadProjectFile, toast } from './open';
import { importSVG } from './svg-import';
import { addLayer } from '../tools/shapes';
import { kb } from '../ui/inspector';
import { renderSymbols } from '../ui/symbols-ui';

export const IDB = {
  db: null as IDBDatabase | null,
  open() {
    return new Promise<IDBDatabase | null>(res => {
      try {
        const r = indexedDB.open('svgcinema', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => {
          IDB.db = r.result;
          res(r.result);
        };
        r.onerror = () => res(null);
        r.onblocked = () => res(null);
      } catch (e) {
        res(null);
      }
    });
  },
  async get(k: string): Promise<any> {
    const db = IDB.db || (await IDB.open());
    if (!db) return null;
    return new Promise<any>(res => {
      try {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result);
        q.onerror = () => res(null);
      } catch (e) {
        res(null);
      }
    });
  },
  async set(k: string, v: unknown): Promise<boolean> {
    if (BATCH) return true; // the batch converter's frame keeps nothing in this browser
    const db = IDB.db || (await IDB.open());
    if (!db) return false;
    return new Promise<any>(res => {
      try {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
        tx.onabort = () => res(false);
      } catch (e) {
        res(false);
      }
    });
  },
};
export let assetWarned = false;
export let assetT: ReturnType<typeof setTimeout> | undefined;
export function saveAssets() {
  clearTimeout(assetT);
  assetT = setTimeout(async () => {
    const ok = await IDB.set('assets', ASSETS);
    if (!ok && !assetWarned) {
      assetWarned = true;
      toast('Images could not be kept in this browser. Use Save project to keep them.');
    }
  }, 400);
}
export const LIB = {
  utif: 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js',
  heic: 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
};
export const loadedLibs: Record<string, Promise<unknown>> = {};
export function loadScript(u: string) {
  return (
    loadedLibs[u] ||
    (loadedLibs[u] = new Promise<unknown>((res, rej) => {
      const s = document.createElement('script');
      s.src = u;
      s.onload = res;
      s.onerror = () => {
        delete loadedLibs[u];
        rej(new Error('could not load the converter'));
      };
      document.head.appendChild(s);
    }))
  );
}
export function dataToBlob(d: string) {
  const i = d.indexOf(','),
    meta = d.slice(5, i),
    mime = meta.split(';')[0] || 'application/octet-stream';
  const raw = atob(d.slice(i + 1));
  const a = new Uint8Array(raw.length);
  for (let j = 0; j < raw.length; j++) a[j] = raw.charCodeAt(j);
  return new Blob([a], { type: mime });
}
export function blobToData(b: Blob) {
  return new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error('could not be read'));
    r.readAsDataURL(b);
  });
}
export function imgDims(blob: Blob) {
  return new Promise<{ w: number; h: number }>((res, rej) => {
    const u = URL.createObjectURL(blob),
      im = new Image();
    im.onload = () => {
      res({ w: im.naturalWidth || 300, h: im.naturalHeight || 150 });
      URL.revokeObjectURL(u);
    };
    im.onerror = () => {
      URL.revokeObjectURL(u);
      rej(new Error('decode'));
    };
    im.src = u;
  });
}
export const EXTMIME: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  pjpeg: 'image/jpeg',
  pjp: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  dib: 'image/bmp',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  jxl: 'image/jxl',
  svg: 'image/svg+xml',
};
export async function tiffToPng(f: Blob): Promise<Blob> {
  await loadScript(LIB.utif);
  const buf = await f.arrayBuffer();
  const ifds = (window as any).UTIF.decode(buf);
  (window as any).UTIF.decodeImage(buf, ifds[0]);
  const rgba = (window as any).UTIF.toRGBA8(ifds[0]),
    w = ifds[0].width,
    h = ifds[0].height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h),
    0,
    0,
  );
  return new Promise<Blob>((res, rej) =>
    cv.toBlob(b => (b ? res(b) : rej(new Error('could not be converted'))), 'image/png'),
  );
}
export async function heicToJpeg(f: Blob): Promise<Blob> {
  await loadScript(LIB.heic);
  const out = await (window as any).heic2any({ blob: f, toType: 'image/jpeg', quality: 0.92 });
  return Array.isArray(out) ? out[0] : out;
}
export async function fileToAsset(f: File): Promise<Omit<Asset, 'id'>> {
  const ext = (f.name.split('.').pop() || '').toLowerCase(),
    mime = f.type && f.type !== 'application/octet-stream' ? f.type : EXTMIME[ext] || '';
  const name = f.name.replace(/\.[^.]+$/, '') || 'image';
  if (mime === 'image/svg+xml' || ext === 'svg') {
    const text = await f.text();
    return {
      kind: 'svg',
      name,
      mime: 'image/svg+xml',
      text,
      data: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text),
      size: f.size,
    };
  }
  let blob = new Blob([f], { type: mime || 'application/octet-stream' }),
    dims = null;
  try {
    dims = await imgDims(blob);
  } catch (e) {}
  if (!dims && mime === 'image/tiff') {
    blob = await tiffToPng(f);
    dims = await imgDims(blob);
  } else if (!dims && /hei[cf]/.test(mime)) {
    blob = await heicToJpeg(f);
    dims = await imgDims(blob);
  }
  if (!dims)
    throw new Error(
      `this browser can't open ${ext ? ext.toUpperCase() + ' ' : ''}images. Convert it to PNG or JPG first.`,
    );
  return { kind: 'image', name, mime: blob.type, data: await blobToData(blob), w: dims.w, h: dims.h, size: blob.size };
}
export function assetURL(a: Asset) {
  return URL.createObjectURL(a.kind === 'svg' ? new Blob([a.text], { type: 'image/svg+xml' }) : dataToBlob(a.data));
}
export function addAsset(src: Omit<Asset, 'id'>): Asset {
  const a = src as Asset;
  a.id = nextAid();
  ASSETS[a.id] = a;
  try {
    URLS[a.id] = assetURL(a);
  } catch (e) {
    URLS[a.id] = a.data;
  }
  saveAssets();
  markDirty();
  return a;
}
export async function importFiles(files: File[], at: { x: number; y: number } | null, place: boolean) {
  let n = 0;
  const errs: string[] = [];
  for (const f of files) {
    if (/\.(svgcinema|zip|json)$/i.test(f.name)) {
      if (await confirmDiscard('Opening another project closes this one. Save your changes first?'))
        await loadProjectFile(f, null);
      return;
    }
    try {
      if (files.length === 1) toast(`Reading ${f.name}…`);
      const a = addAsset(await fileToAsset(f));
      n++;
      if (place) placeAsset(a, at);
    } catch (e) {
      errs.push(`${f.name}: ${(e && e.message) || 'could not be read'}`);
    }
  }
  renderAssets();
  if (errs.length) toast(errs[0]);
  else if (n)
    toast(
      place ? `Added ${n} file${n > 1 ? 's' : ''} to the canvas.` : `Added ${n} file${n > 1 ? 's' : ''} to Assets.`,
    );
}
export function placeAsset(a: Asset, at: { x: number; y: number } | null) {
  if (a.kind === 'svg') {
    importSVG(a.text, false, a.name, at);
    return;
  }
  const ed = beginEdit(),
    s = Math.min(1, (0.7 * doc.w) / a.w, (0.7 * doc.h) / a.h),
    w = r2(a.w * s),
    h = r2(a.h * s);
  const cx = at ? at.x : (doc.vx || 0) + doc.w / 2,
    cy = at ? at.y : (doc.vy || 0) + doc.h / 2;
  const l = mkLayer('image', a.name, { x: r2(cx - w / 2), y: r2(cy - h / 2), w, h, asset: a.id }, NOFILL);
  addLayer(l);
  ed.end({ insp: true });
}
export function usage(id: string) {
  return doc.layers.filter(l => l.type === 'image' && l.geo.asset === id).length;
}
export function renderAssets() {
  renderSymbols();
  const ids = Object.keys(ASSETS),
    total = ids.reduce((s, id) => s + (ASSETS[id].size || 0), 0);
  $('#aInfo').textContent = ids.length ? `${ids.length} file${ids.length > 1 ? 's' : ''} · ${kb(total)}` : '';
  AG.innerHTML = ids.length
    ? ids
        .map(id => {
          const a = ASSETS[id],
            u = usage(id),
            type =
              a.kind === 'svg' ? 'SVG' : (a.mime || '').replace('image/', '').replace('x-icon', 'ico').toUpperCase();
          return `<div class="at" draggable="true" data-aid="${id}" title="Click to add to the canvas, or drag it there"><button class="th" data-aact="place" aria-label="Add ${esc(a.name)} to the canvas"><img src="${esc(URLS[id] || a.data)}" alt=""></button>
      <div class="meta"><b>${esc(a.name)}</b><span>${type}${a.w ? ` · ${a.w}×${a.h}` : ''} · ${kb(a.size || 0)}${u ? ` · used ${u}×` : ''}</span></div>
      <button class="tl-ic del" data-aact="del" aria-label="Delete ${esc(a.name)}">${ICON.x}</button></div>`;
        })
        .join('')
    : `<div class="ag-empty">Drop images or SVG files here, or use <b>Add files</b>.<br>PNG, JPG, GIF, WebP, AVIF, BMP, ICO, TIFF and HEIC are supported. Click a file to put it on the canvas.</div>`;
}

export function init(): void {
  AG.addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('[data-aact]');
    if (!b) return;
    const id = b.closest('[data-aid]').dataset.aid,
      a = ASSETS[id];
    if (b.dataset.aact === 'place') placeAsset(a, null);
    else {
      const u = usage(id);
      if (u) {
        toast(`“${a.name}” is used by ${u} layer${u > 1 ? 's' : ''}. Delete those layers first.`);
        return;
      }
      delete ASSETS[id];
      try {
        URL.revokeObjectURL(URLS[id]);
      } catch (_) {}
      delete URLS[id];
      saveAssets();
      markDirty();
      renderAssets();
    }
  });
  AG.addEventListener('dragstart', (e: DragEvent) => {
    const t = (e.target as any).closest('[data-aid]');
    if (!t) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/x-svgcinema-asset', t.dataset.aid);
  });
  AG.addEventListener('dragover', (e: DragEvent) => {
    if ([...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
      AG.classList.add('over');
    }
  });
  AG.addEventListener('dragleave', () => AG.classList.remove('over'));
  AG.addEventListener('drop', (e: DragEvent) => {
    AG.classList.remove('over');
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    importFiles([...e.dataTransfer.files], null, false);
  });
  $('#aAdd').addEventListener('click', () => {
    S.pickPlace = false;
    $('#fSvg').click();
  });
}
