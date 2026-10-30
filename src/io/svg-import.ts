// SVGcinema — io/svg-import
// Opening an SVG as a project and adding one to the current project (pasted, dropped, or placed from
// Assets). The file is turned into editable layers (io/svg-convert); an animated SVG from SVGator keeps
// its animation as keyframes (io/svgator), and an SVG exported by SVGcinema with its project inside
// opens as that project.
import type { Asset, Doc, Layer, XY } from '../model/types';
import { $, NOFILL, NS, byId, esc, r3 } from '../core/constants';
import { beginEdit } from '../core/history';
import { ASSETS, S, blankDoc, doc, mkLayer, nextAid, setIdc, syncIdc, uid } from '../core/state';
import { addAsset, dataToBlob, imgDims, renderAssets } from './assets';
import { updateFileInfo } from './file-state';
import { applyProject, toast } from './open';
import { Converter, type AnimReader } from './svg-convert';
import { moveOrigin } from './svg-paint';
import { readAnimation } from './svgator';
import { readEmbedded, renumber } from './embed';
import { renderAll, renderStage } from '../render/stage';
import { layerBox } from '../render/mesh';

export { parseStyle } from './svg-paint';
import { EPHEMERAL } from '../core/batch-mode';

/** the <svg> element of SVG text, or null */
export function parseSVG(text: string): Element | null {
  let dom: Document | null = null;
  try {
    dom = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch (_) {
    dom = null;
  }
  let root: Element | null = dom && dom.documentElement;
  // (test DOMs without an XML parser: read it as HTML)
  if (!root && dom && /<svg[\s>]/i.test(text))
    root = new DOMParser().parseFromString(text, 'text/html').querySelector('svg');
  if (!root || root.localName !== 'svg' || root.namespaceURI !== NS || dom.getElementsByTagName('parsererror').length)
    return null;
  return root;
}
/** the canvas of an SVG: its viewBox, else its width and height */
export function svgBox(root: Element): number[] {
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
  if (vb.length === 4 && vb.every(isFinite) && vb[2] > 0 && vb[3] > 0) return vb;
  const px = (v: string | null) => (v && !/%$/.test(v) ? parseFloat(v) : NaN),
    w = px(root.getAttribute('width')),
    h = px(root.getAttribute('height'));
  return [0, 0, w > 0 ? w : 640, h > 0 ? h : 400];
}
/** natural sizes of the embedded pictures */
async function pictureSizes(root: Element) {
  const out: Record<string, { w: number; h: number }> = {};
  const hrefs = new Set<string>();
  root.querySelectorAll('image').forEach(im => {
    const h =
      im.getAttribute('href') ||
      im.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      im.getAttribute('xlink:href') ||
      '';
    if (/^data:image\//i.test(h)) hrefs.add(h);
  });
  await Promise.all(
    [...hrefs].map(async h => {
      try {
        out[h] = await imgDims(dataToBlob(h));
      } catch (_) {}
    }),
  );
  return out;
}
function mimeOf(href: string) {
  return (/^data:([^;,]+)/.exec(href) || [])[1] || 'image/png';
}
function bytesOf(href: string) {
  const i = href.indexOf(',');
  return Math.round(((href.length - i - 1) * 3) / 4);
}

export interface ImportOptions {
  /** open as a new project (replacing the current one) */
  project?: boolean;
  /** the file or asset name */
  name?: string;
  /** add mode: where to centre it on the canvas */
  at?: XY | null;
}
/** Import SVG text. Returns false (after telling the user) when it isn't SVG. */
export async function importSVG(text: string, replace?: boolean, name?: string, at?: XY | null): Promise<boolean> {
  return importSVGWith(text, { project: !!replace, name, at });
}
export async function importSVGWith(text: string, o: ImportOptions): Promise<boolean> {
  const root = parseSVG(text);
  if (!root) {
    toast('That file is not valid SVG markup.');
    return false;
  }
  // an SVG exported by SVGcinema with its project inside
  const emb = readEmbedded(root);
  if (emb && o.project) {
    applyProject(emb.doc, emb.assets, null);
    S.dirty = true;
    updateFileInfo();
    toast(`Opened ${o.name || 'the SVG'} as its SVGcinema project.`);
    return true;
  }
  if (emb) return addEmbedded(emb, o);
  const sizes = await pictureSizes(root);
  let anim: AnimReader | null = null;
  try {
    anim = readAnimation(root, text);
  } catch (e) {
    anim = null;
  }
  return o.project ? openAsProject(root, o, sizes, anim) : addToProject(root, o, sizes, anim);
}

function openAsProject(
  root: Element,
  o: ImportOptions,
  sizes: Record<string, { w: number; h: number }>,
  anim: AnimReader | null,
) {
  setIdc(0);
  const box = svgBox(root),
    d: Doc = blankDoc(box[2], box[3]);
  d.vx = box[0];
  d.vy = box[1];
  d.bg = backgroundOf(root);
  d.name = projectName(root, o.name);
  const assets: Record<string, Asset> = {},
    byHref: Record<string, string> = {};
  let n = 0;
  const cv = new Converter(root, {
    anim,
    image(href, nm) {
      const sz = sizes[href];
      if (!sz) return null;
      if (!byHref[href]) {
        const id = 'a' + ++n;
        assets[id] = {
          id,
          kind: 'image',
          name: nm,
          mime: mimeOf(href),
          data: href,
          w: sz.w,
          h: sz.h,
          size: bytesOf(href),
        };
        byHref[href] = id;
      }
      return { id: byHref[href], w: sz.w, h: sz.h };
    },
  }).run();
  d.layers = cv.layers;
  d.defs = cv.defsMarkup();
  if (anim) applySettings(d, anim.settings);
  applyProject(d, assets, null);
  centerOrigins(cv);
  renderAll();
  S.dirty = true;
  updateFileInfo();
  report(`Opened ${o.name || d.name}`, cv, anim);
  return true;
}
function addToProject(
  root: Element,
  o: ImportOptions,
  sizes: Record<string, { w: number; h: number }>,
  anim: AnimReader | null,
) {
  const ed = beginEdit(),
    box = svgBox(root),
    had = doc.layers.length > 0;
  // pasted into an empty project: it takes the SVG's canvas
  if (!had && !o.name) {
    doc.vx = box[0];
    doc.vy = box[1];
    doc.w = box[2];
    doc.h = box[3];
  }
  const byHref: Record<string, string> = {};
  Object.values(ASSETS).forEach(a => a.kind === 'image' && a.data && (byHref[a.data] = a.id));
  const cv = new Converter(root, {
    anim,
    image(href, nm) {
      const sz = sizes[href];
      if (!sz) return null;
      if (!byHref[href])
        byHref[href] = addAsset({
          kind: 'image',
          name: nm,
          mime: mimeOf(href),
          data: href,
          w: sz.w,
          h: sz.h,
          size: bytesOf(href),
        }).id;
      return { id: byHref[href], w: sz.w, h: sz.h };
    },
  }).run();
  // definitions get their own ids, so they can't clash with the project's
  const pre = 'i' + nextAid().slice(1) + '-';
  const defs = cv.defsMarkup();
  if (defs) {
    const ids = [...cv.refs];
    const fix = (s: string) =>
      ids.reduce(
        (acc, id) => acc.split(`url(#${id})`).join(`url(#${pre}${id})`).split(`"#${id}"`).join(`"#${pre}${id}"`),
        s,
      );
    doc.defs = (doc.defs || '') + fix(ids.reduce((acc, id) => acc.split(`id="${id}"`).join(`id="${pre}${id}"`), defs));
    cv.layers.forEach(l => {
      ['fill', 'stk'].forEach(k => typeof l.b[k] === 'string' && (l.b[k] = fix(l.b[k])));
      for (const k in l.extra) l.extra[k] = fix(l.extra[k]);
      if (l.type === 'raw' && l.geo.markup) l.geo.markup = fix(l.geo.markup);
    });
  }
  let wrap: Layer | null = null;
  if (had || o.name) {
    wrap = mkLayer('group', o.name || 'Imported SVG', {}, NOFILL);
    // the SVG's canvas lands on the project's canvas, or centred where it was dropped
    const c = [box[0] + box[2] / 2, box[1] + box[3] / 2],
      to = o.at ? [o.at.x, o.at.y] : [(doc.vx || 0) + doc.w / 2, (doc.vy || 0) + doc.h / 2];
    wrap.o = [r3(c[0]), r3(c[1])];
    wrap.b.pos = [r3(to[0] - c[0]), r3(to[1] - c[1])];
    doc.layers.push(wrap);
    S.lexp[wrap.id] = true;
    cv.layers.forEach(l => !l.parent && (l.parent = wrap.id));
  }
  doc.layers.push(...cv.layers);
  syncIdc();
  // the timeline grows to fit a longer animation
  const dur = anim && anim.settings.dur;
  const grew = !!dur && dur > doc.dur + 1e-6;
  if (grew) doc.dur = r3(dur);
  renderStage();
  centerOrigins(cv);
  S.keys.clear();
  if (wrap) {
    S.sel = wrap.id;
    S.selSet = new Set([wrap.id]);
  }
  ed.end({ insp: true });
  renderAssets();
  report(
    `Imported ${cv.layers.length} layer${cv.layers.length === 1 ? '' : 's'}${wrap ? ` into “${wrap.name}”` : ''}${grew ? `; the timeline is now ${r3(doc.dur)} s` : ''}`,
    cv,
    anim,
  );
  return true;
}
/** An SVGcinema export with its project inside, added to this project: its layers, exactly. */
function addEmbedded(emb: { doc: Doc; assets: Record<string, Asset> }, o: ImportOptions) {
  const ed = beginEdit(),
    ids: Record<string, string> = {};
  Object.values(emb.assets).forEach(a => {
    const have = Object.values(ASSETS).find(x => x.data === a.data);
    ids[a.id] = have ? have.id : addAsset({ ...a, id: undefined } as any).id;
  });
  const layers = renumber(emb.doc.layers, uid, ids),
    wrap = mkLayer('group', o.name || emb.doc.name || 'Imported SVG', {}, NOFILL),
    c = [(emb.doc.vx || 0) + emb.doc.w / 2, (emb.doc.vy || 0) + emb.doc.h / 2],
    to = o.at ? [o.at.x, o.at.y] : [(doc.vx || 0) + doc.w / 2, (doc.vy || 0) + doc.h / 2];
  wrap.o = [r3(c[0]), r3(c[1])];
  wrap.b.pos = [r3(to[0] - c[0]), r3(to[1] - c[1])];
  layers.forEach(l => !l.parent && (l.parent = wrap.id));
  doc.layers.push(wrap, ...layers);
  if (emb.doc.defs) doc.defs = (doc.defs || '') + emb.doc.defs;
  const grew = emb.doc.dur > doc.dur + 1e-6;
  if (grew) doc.dur = r3(emb.doc.dur);
  S.lexp[wrap.id] = true;
  S.sel = wrap.id;
  S.selSet = new Set([wrap.id]);
  S.keys.clear();
  ed.end({ insp: true });
  renderAssets();
  toast(
    `Added “${wrap.name}” from its SVGcinema project (${layers.length} layers${grew ? `; the timeline is now ${r3(doc.dur)} s` : ''}).`,
  );
  return true;
}
function applySettings(d: Doc, s: AnimReader['settings']) {
  if (s.dur > 0) d.dur = r3(s.dur);
  if (s.it != null) d.it = s.it;
  if (s.dir) d.dir = s.dir;
  if (s.fill) d.ex.fill = s.fill;
  if (s.speed > 0) d.ex.speed = s.speed;
  if (s.fps != null) d.ex.fps = s.fps >= 100 ? 0 : s.fps;
  if (s.trigger) d.ex.trigger = s.trigger as Doc['ex']['trigger'];
  if (s.out) d.ex.out = s.out;
}
function backgroundOf(root: Element) {
  const st = root.getAttribute('style') || '',
    m = /background(?:-color)?\s*:\s*([^;]+)/i.exec(st);
  return m && !/none|transparent/i.test(m[1]) ? m[1].trim() : '';
}
function projectName(root: Element, file?: string) {
  const t = Array.from(root.children).find(c => c.localName === 'title');
  if (t && t.textContent.trim()) return t.textContent.trim();
  const id = root.getAttribute('id') || '';
  // SVGator writes the project name as the id when exporting element names as ids
  if (id && !/^e[0-9A-Za-z]{10,12}$/.test(id) && /[-a-z]/.test(id) && !/^svg\d*$/i.test(id)) return id;
  return file || 'Imported animation';
}
/** Put each unanimated layer's origin in the middle of what it draws (as drawn layers have it). The
 *  import placed them with the origin at their own 0,0; moving it doesn't move them. */
export function centerOrigins(cv: Converter) {
  const fixed = (l: Layer) => ['pos', 'org', 'rot', 'scl', 'skw', 'sz'].some(k => l.t[k] && l.t[k].length);
  cv.layers.forEach(l => {
    if (l.hid || fixed(l) || cv.keepOrigin.has(l)) return;
    if (!byId('e-' + l.id)) return;
    let b = null;
    try {
      b = layerBox(l);
    } catch (_) {}
    if (!b || !isFinite(b.x) || (!b.width && !b.height)) return;
    moveOrigin(l, [b.x + b.width / 2, b.y + b.height / 2]);
  });
}
/** a toast when everything came across, else a short list of what didn't */
/** what the last import couldn't bring across (read by the batch converter) */
export let lastImportNotes: string[] = [];
function report(title: string, cv: Converter, anim: AnimReader | null) {
  const notes = [...cv.notes, ...(anim ? anim.notes : [])];
  lastImportNotes = notes;
  if (EPHEMERAL) return;
  if (!notes.length) {
    toast(`${title}.`);
    return;
  }
  const m = $('#mImpRep');
  if (!m) {
    toast(`${title}. ${notes[0]}`);
    return;
  }
  $('#irTitle').textContent = title;
  $('#irList').innerHTML = notes.map(n => `<li>${esc(n)}</li>`).join('');
  m.hidden = false;
}
