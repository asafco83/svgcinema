// SVGcinema — agent/attach
// Files attached to a message for the design agent: images (PNG, JPG, WebP, GIF) and SVG, up to 4.
// Each one goes into the project's Assets as it is attached, so the agent can put it on the canvas
// (place_image; an SVG comes in as editable layers). In the text, "@name" refers to an attachment;
// the composer colours those references, and shows "@file.png" in red when that file isn't attached.
// The message tells the model each file's asset id; a model that can see also gets the pictures.
import type { Asset } from '../model/types';
import { ASSETS, URLS } from '../core/state';
import { addAsset, fileToAsset, renderAssets, saveAssets, usage } from '../io/assets';
import { markDirty } from '../io/file-state';
import type { Part } from './clients/types';

export interface Att {
  /** the asset in the project */
  id: string;
  /** the name to write after "@": the file name with its extension, no spaces */
  name: string;
  kind: 'image' | 'svg';
  w?: number;
  h?: number;
  /** SVG: how many drawn elements it has */
  parts?: number;
}

export const MAX_ATT = 4;
/** what the paperclip's file picker offers */
export const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.svg,image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const OK_EXT = /\.(png|jpe?g|webp|gif|svg)$/i,
  OK_MIME = /^image\/(png|jpeg|webp|gif|svg\+xml)$/;

/** The message being written: its attachments, in order. */
export const ATTACH: { list: Att[] } = { list: [] };

export const isAttachable = (f: { name: string; type: string }) => OK_MIME.test(f.type) || OK_EXT.test(f.name);

/** A reference name for a file: its name without spaces, unique among `taken`. */
export function refName(file: string, taken: string[]) {
  const base = (file || 'image').trim().replace(/\s+/g, '-').replace(/@/g, '') || 'image',
    m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(base)!,
    stem = m[1] || 'image',
    ext = (m[2] || '').toLowerCase();
  const low = taken.map(t => t.toLowerCase());
  let n = stem + ext,
    i = 2;
  while (low.includes(n.toLowerCase())) n = `${stem}-${i++}${ext}`;
  return n;
}

/** How many drawn elements an SVG has (shown as "vector · 3 parts"). */
export function svgParts(text: string) {
  return (text.match(/<(path|rect|circle|ellipse|polygon|polyline|line|text|image|use)\b/gi) || []).length;
}

/** The second line of an attachment's chip: its size, or "vector · n parts". */
export function attMeta(a: Att) {
  if (a.kind === 'svg') return a.parts ? `vector · ${a.parts} part${a.parts > 1 ? 's' : ''}` : 'vector';
  return a.w && a.h ? `${a.w} × ${a.h}` : 'image';
}

/** Attach files: each accepted one is added to Assets. Returns what was added and why others weren't. */
export async function attachFiles(files: File[]): Promise<{ added: Att[]; errors: string[] }> {
  const added: Att[] = [],
    errors: string[] = [];
  for (const f of files) {
    if (!isAttachable(f)) {
      errors.push(`${f.name}: attach PNG, JPG, WebP, GIF or SVG files.`);
      continue;
    }
    if (ATTACH.list.length >= MAX_ATT) {
      errors.push(`Up to ${MAX_ATT} files per message.`);
      break;
    }
    try {
      const a = addAsset(await fileToAsset(f));
      const att: Att = {
        id: a.id,
        name: refName(
          f.name,
          ATTACH.list.map(x => x.name),
        ),
        kind: a.kind === 'svg' ? 'svg' : 'image',
        ...(a.kind === 'svg' ? { parts: svgParts(a.text || '') } : { w: a.w, h: a.h }),
      };
      ATTACH.list.push(att);
      added.push(att);
    } catch (e) {
      errors.push(`${f.name}: ${(e && (e as Error).message) || 'could not be read'}`);
    }
  }
  if (added.length) renderAssets();
  return { added, errors };
}

/**
 * Take an attachment off the message. Its asset leaves Assets too when nothing uses it: no layer, and
 * no message already sent (`keep`: asset ids earlier messages refer to).
 */
export function detach(id: string, keep: string[] = []) {
  ATTACH.list = ATTACH.list.filter(a => a.id !== id);
  if (!ASSETS[id] || usage(id) || keep.includes(id)) return;
  delete ASSETS[id];
  try {
    URL.revokeObjectURL(URLS[id]);
  } catch (_) {
    /* not a blob URL */
  }
  delete URLS[id];
  saveAssets();
  markDirty();
  renderAssets();
}

/** "@name.ext" in the text: a reference to an attachment, or (no such file attached) a broken one. */
export const REF_RE = /(^|[\s(["'])@([^\s@"'()[\]]+?\.(?:png|jpe?g|webp|gif|svg))(?=$|[\s,.;:!?)\]"'])/gi;

export type Seg = { t: 'text'; s: string } | { t: 'ref'; s: string; att: Att } | { t: 'bad'; s: string };

/** Split text into plain runs, references to `list`, and broken references (red in the composer). */
export function segments(text: string, list: Att[]): Seg[] {
  const out: Seg[] = [];
  let at = 0;
  REF_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = REF_RE.exec(text)); ) {
    const start = m.index + m[1].length,
      s = '@' + m[2],
      att = list.find(a => a.name.toLowerCase() === m![2].toLowerCase());
    if (start > at) out.push({ t: 'text', s: text.slice(at, start) });
    out.push(att ? { t: 'ref', s, att } : { t: 'bad', s });
    at = start + s.length;
  }
  if (at < text.length) out.push({ t: 'text', s: text.slice(at) });
  return out;
}

/** The reference that ends at (`end`) or starts at (`start`) the caret, for deleting it whole. */
export function refAt(text: string, pos: number, list: Att[], side: 'end' | 'start') {
  let i = 0;
  for (const g of segments(text, list)) {
    const j = i + g.s.length;
    if (g.t === 'ref' && (side === 'end' ? j === pos : i === pos)) return { from: i, to: j };
    i = j;
  }
  return null;
}

/** The "@query" being typed just before the caret, if any (for the list of attachments). */
export function atQuery(text: string, caret: number) {
  const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return m ? { from: caret - m[2].length - 1, q: m[2] } : null;
}
/** Attachments that match what follows the "@" (any part of the name, the start first). */
export function matches(q: string, list: Att[]) {
  const s = q.toLowerCase(),
    hit = list.filter(a => a.name.toLowerCase().includes(s));
  return [
    ...hit.filter(a => a.name.toLowerCase().startsWith(s)),
    ...hit.filter(a => !a.name.toLowerCase().startsWith(s)),
  ];
}

/** What the model reads about the attachments, after the user's text. */
export function attachNote(list: Att[], see: boolean) {
  if (!list.length) return '';
  const lines = list.map(
    a => `@${a.name}: asset ${a.id}, ${a.kind === 'svg' ? 'SVG (placed as editable layers)' : `image ${attMeta(a)}`}`,
  );
  return `

<attachments note="files the user attached to this message, already in the project's Assets; @name in the message means that file; place_image puts one on the canvas${
    see ? '; the pictures follow, in this order' : "; you can't see them, so ask what they show if it matters"
  }">
${lines.join('\n')}
</attachments>`;
}

const MAX_SIDE = 1568;
/** The attachments as pictures for a model that can see: PNG, at most 1568 px on a side. */
export async function attachPictures(list: Att[]): Promise<Part[]> {
  const out: Part[] = [];
  for (const a of list) {
    const asset = ASSETS[a.id] as Asset | undefined;
    if (!asset) continue;
    try {
      out.push(await toPNG(URLS[a.id] || asset.data));
    } catch (_) {
      /* a picture the browser can't draw: the model still has its name and id */
    }
  }
  return out;
}
function toPNG(src: string): Promise<Part> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const w0 = im.naturalWidth || 300,
        h0 = im.naturalHeight || 150,
        k = Math.min(1, MAX_SIDE / Math.max(w0, h0)),
        cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w0 * k));
      cv.height = Math.max(1, Math.round(h0 * k));
      const g = cv.getContext('2d');
      if (!g) return rej(new Error('no canvas'));
      g.drawImage(im, 0, 0, cv.width, cv.height);
      const url = cv.toDataURL('image/png');
      res({ type: 'image', mime: 'image/png', data: url.slice(url.indexOf(',') + 1) });
    };
    im.onerror = () => rej(new Error('decode'));
    im.src = src;
  });
}
