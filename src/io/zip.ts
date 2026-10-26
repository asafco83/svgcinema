// SVGcinema — io/zip
import { ASSETS, doc } from '../core/state';
import { slug } from '../export/images';
import { THUMB_NAME, thumbnailPNG } from './thumbnail';
import { extraFiles } from './extras';

export const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
/** One entry to write into a zip. */
export interface ZipInput {
  name: string;
  data: Uint8Array;
  compress?: boolean;
}
export interface ZipReader {
  names: string[];
  get(name: string): Promise<Uint8Array | null>;
  text(name: string): Promise<string | null>;
}
export function crc32(u8: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export async function deflateRaw(u8: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    return new Uint8Array(
      await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer(),
    );
  } catch (e) {
    return null;
  }
}
export async function inflateRaw(u8: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser can’t unpack compressed project files');
  return new Uint8Array(
    await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer(),
  );
}
export async function makeZip(files: ZipInput[]): Promise<Blob> {
  const enc = new TextEncoder(),
    parts: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let off = 0;
  const d = new Date(),
    dt = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dd = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const nm = enc.encode(f.name),
      crc = crc32(f.data);
    let body = f.data,
      method = 0;
    if (f.compress) {
      const z = await deflateRaw(f.data);
      if (z && z.length < f.data.length) {
        body = z;
        method = 8;
      }
    }
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true);
    lh.setUint16(10, dt, true);
    lh.setUint16(12, dd, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true);
    lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, nm.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nm, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true);
    ch.setUint16(12, dt, true);
    ch.setUint16(14, dd, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true);
    ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, nm.length, true);
    ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + body.length;
  }
  const cs = central.reduce((s, x) => s + x.length, 0),
    end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cs, true);
  end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
export async function readZip(buf: ArrayBuffer): Promise<ZipReader> {
  const u8 = new Uint8Array(buf),
    dv = new DataView(buf);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65558); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      e = i;
      break;
    }
  if (e < 0) throw new Error('the file is damaged or not an SVGcinema project');
  const n = dv.getUint16(e + 10, true),
    dec = new TextDecoder(),
    ent: Record<string, { method: number; data: Uint8Array }> = {};
  let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('the file is damaged');
    const method = dv.getUint16(p + 10, true),
      csz = dv.getUint32(p + 20, true),
      nl = dv.getUint16(p + 28, true),
      xl = dv.getUint16(p + 30, true),
      cl = dv.getUint16(p + 32, true),
      lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)),
      start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    ent[name] = { method, data: u8.subarray(start, start + csz) };
    p += 46 + nl + xl + cl;
  }
  const get = async (name: string) => {
    const f = ent[name];
    if (!f) return null;
    if (f.method === 0) return f.data;
    if (f.method === 8) return inflateRaw(f.data);
    throw new Error('the file uses an unsupported compression');
  };
  return {
    names: Object.keys(ent),
    get,
    text: async (name: string) => {
      const d = await get(name);
      return d ? dec.decode(d) : null;
    },
  };
}
export const EXT_OF: Record<string, string> = {
  'image/png': 'png',
  'image/apng': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/tiff': 'tif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jxl': 'jxl',
  'image/svg+xml': 'svg',
};
export function dataToBytes(d: string) {
  const i = d.indexOf(','),
    meta = d.slice(5, i);
  if (/;base64/i.test(meta)) {
    const raw = atob(d.slice(i + 1)),
      a = new Uint8Array(raw.length);
    for (let j = 0; j < raw.length; j++) a[j] = raw.charCodeAt(j);
    return a;
  }
  return new TextEncoder().encode(decodeURIComponent(d.slice(i + 1)));
}
export function usedAssetIds() {
  return new Set<string>(doc.layers.filter(l => l.type === 'image').map(l => l.geo.asset));
}
export async function buildProject(includeAll?: boolean) {
  const enc = new TextEncoder(),
    used = usedAssetIds(),
    ids = Object.keys(ASSETS).filter(id => includeAll || used.has(id)),
    index: Array<Record<string, unknown>> = [],
    files: ZipInput[] = [];
  ids.forEach(id => {
    const a = ASSETS[id],
      ext = a.kind === 'svg' ? 'svg' : EXT_OF[a.mime] || 'bin',
      file = `assets/${id}-${slug(a.name).slice(0, 40)}.${ext}`;
    const bytes = a.kind === 'svg' ? enc.encode(a.text || '') : dataToBytes(a.data);
    index.push({ id, name: a.name, kind: a.kind, mime: a.mime, w: a.w, h: a.h, size: bytes.length, file });
    files.push({ name: file, data: bytes, compress: a.kind === 'svg' || /bmp|x-icon|tiff/.test(a.mime || '') });
  });
  const manifest = {
    format: 'svgcinema-project',
    version: 3,
    app: 'SVGcinema',
    name: doc.name,
    saved: new Date().toISOString(),
    canvas: [doc.w, doc.h],
    duration: doc.dur,
    layers: doc.layers.length,
    assets: index.length,
  };
  // the first frame, first in the zip and uncompressed, for file managers' thumbnail handlers
  const thumb = await thumbnailPNG();
  return makeZip([
    ...(thumb ? [{ name: THUMB_NAME, data: thumb }] : []),
    { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 2)), compress: true },
    { name: 'project.json', data: enc.encode(JSON.stringify(doc)), compress: true },
    { name: 'assets/index.json', data: enc.encode(JSON.stringify(index, null, 2)), compress: true },
    // files other parts of the editor keep with the project (the design agent's chat)
    ...extraFiles(),
    ...files,
  ]);
}
