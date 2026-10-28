// SVGcinema — export/mux
// Video files from encoded frames, written here rather than with a library: MP4 (H.264) and WebM
// (VP9 or AV1, with an alpha channel when the encoder gives one). Everything is in memory, so each
// file gets its index up front: the MP4's moov box comes before the frames (it starts playing while
// it downloads), and the WebM has its duration and a cue for every cluster (it seeks properly).

/** One encoded frame, in decoding order. */
export interface VSample {
  data: Uint8Array;
  key: boolean;
  /** presentation time, microseconds */
  ts: number;
  /** WebM with alpha: the frame's alpha channel, encoded alongside */
  alpha?: Uint8Array | null;
}
export interface VTrack {
  width: number;
  height: number;
  fps: number;
  samples: VSample[];
  /** the decoder configuration the encoder reported (avcC for H.264; av1C for AV1 when given) */
  description?: Uint8Array | null;
}

/* ---------------- bytes ---------------- */

const enc = new TextEncoder();
function cat(parts: Uint8Array[]) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const u8 = (v: number) => Uint8Array.of(v & 255);
const u16 = (v: number) => Uint8Array.of((v >>> 8) & 255, v & 255);
const u32 = (v: number) => Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const str = (s: string) => enc.encode(s);
const zeros = (n: number) => new Uint8Array(n);

/* ---------------- MP4 ---------------- */

function box(type: string, ...body: Uint8Array[]) {
  const b = cat(body);
  return cat([u32(b.length + 8), str(type), b]);
}
function fbox(type: string, version: number, flags: number, ...body: Uint8Array[]) {
  return box(type, u8(version), u8(flags >> 16), u8(flags >> 8), u8(flags), ...body);
}
const MATRIX = cat([0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(u32));
/** Run-length entries [count, value] for stts and ctts. */
function runs(vals: number[]) {
  const out: [number, number][] = [];
  for (const v of vals) {
    const last = out[out.length - 1];
    if (last && last[1] === v) last[0]++;
    else out.push([1, v]);
  }
  return out;
}

/** An MP4 file (fast start) holding one H.264 track. */
export function muxMP4(t: VTrack): Uint8Array {
  if (!t.description) throw new Error('The H.264 encoder gave no decoder configuration.');
  const ts = Math.round(t.fps * 1000),
    fd = 1000,
    S = t.samples,
    n = S.length;
  // decoding times step one frame each; presentation times come from the encoder
  const pts = S.map(s => Math.round((s.ts * ts) / 1e6)),
    dts = S.map((_, i) => i * fd);
  let delay = 0;
  pts.forEach((p, i) => (delay = Math.max(delay, dts[i] - p)));
  const offs = pts.map((p, i) => p + delay - dts[i]),
    needCtts = offs.some(o => o !== 0);
  const durTs = n * fd,
    durMs = Math.round((durTs * 1000) / ts);
  const ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'));
  const moov = (chunkOffset: number) => {
    const mvhd = fbox(
      'mvhd',
      0,
      0,
      u32(0),
      u32(0),
      u32(1000),
      u32(durMs),
      u32(0x10000),
      u16(0x100),
      zeros(10),
      MATRIX,
      zeros(24),
      u32(2),
    );
    const tkhd = fbox(
      'tkhd',
      0,
      3,
      u32(0),
      u32(0),
      u32(1),
      u32(0),
      u32(durMs),
      zeros(8),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      MATRIX,
      u32(t.width << 16),
      u32(t.height << 16),
    );
    const edts = delay
      ? box('edts', fbox('elst', 0, 0, u32(1), u32(durMs), u32(delay), u16(1), u16(0)))
      : new Uint8Array(0);
    const mdhd = fbox('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(durTs), u16(0x55c4), u16(0));
    const hdlr = fbox('hdlr', 0, 0, u32(0), str('vide'), zeros(12), str('SVGcinema video\0'));
    const vmhd = fbox('vmhd', 0, 1, u16(0), zeros(6));
    const dinf = box('dinf', fbox('dref', 0, 0, u32(1), fbox('url ', 0, 1)));
    const name = zeros(32);
    const avc1 = box(
      'avc1',
      zeros(6),
      u16(1),
      u16(0),
      u16(0),
      zeros(12),
      u16(t.width),
      u16(t.height),
      u32(0x480000),
      u32(0x480000),
      u32(0),
      u16(1),
      name,
      u16(0x18),
      u16(0xffff),
      box('avcC', t.description!),
    );
    const stsd = fbox('stsd', 0, 0, u32(1), avc1);
    const sttsR = runs(dts.map(() => fd));
    const stts = fbox('stts', 0, 0, u32(sttsR.length), ...sttsR.map(([c, v]) => cat([u32(c), u32(v)])));
    const cttsR = runs(offs);
    const ctts = needCtts
      ? fbox('ctts', 0, 0, u32(cttsR.length), ...cttsR.map(([c, v]) => cat([u32(c), u32(v)])))
      : new Uint8Array(0);
    const keys = S.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
    const stss = fbox('stss', 0, 0, u32(keys.length), ...keys.map(u32));
    const stsc = fbox('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1));
    const stsz = fbox('stsz', 0, 0, u32(0), u32(n), ...S.map(s => u32(s.data.length)));
    const stco = fbox('stco', 0, 0, u32(1), u32(chunkOffset));
    const stbl = box('stbl', stsd, stts, ctts, stss, stsc, stsz, stco);
    const minf = box('minf', vmhd, dinf, stbl);
    const mdia = box('mdia', mdhd, hdlr, minf);
    const trak = box('trak', tkhd, edts, mdia);
    return box('moov', mvhd, trak);
  };
  const size = moov(0).length,
    mdatBody = cat(S.map(s => s.data));
  return cat([ftyp, moov(ftyp.length + size + 8), u32(mdatBody.length + 8), str('mdat'), mdatBody]);
}

/* ---------------- WebM (Matroska) ---------------- */

/** An element ID as written (its length marker included). */
const idBytes = (id: number) => {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 255);
  return Uint8Array.from(out);
};
/** A size as an 8-byte EBML number (fixed width keeps offsets easy to compute). */
function size8(n: number) {
  const b = new Uint8Array(8);
  b[0] = 0x01;
  let v = n;
  for (let i = 7; i >= 1; i--) {
    b[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return b;
}
/** A size in as few bytes as it needs. */
function sizeV(n: number) {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const b = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        b[i] = v % 256;
        v = Math.floor(v / 256);
      }
      b[0] |= 0x80 >> (len - 1);
      return b;
    }
  }
  return size8(n);
}
function el(id: number, ...body: Uint8Array[]) {
  const b = cat(body);
  return cat([idBytes(id), sizeV(b.length), b]);
}
/** An element with an 8-byte size (for the ones whose position or size others point at). */
function elFixed(id: number, ...body: Uint8Array[]) {
  const b = cat(body);
  return cat([idBytes(id), size8(b.length), b]);
}
function uint(n: number) {
  const out: number[] = [];
  let v = n;
  do {
    out.unshift(v % 256);
    v = Math.floor(v / 256);
  } while (v > 0);
  return Uint8Array.from(out);
}
const uintEl = (id: number, n: number) => el(id, uint(n));
const u64 = (n: number) => {
  const b = new Uint8Array(8);
  let v = n;
  for (let i = 7; i >= 0; i--) {
    b[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return b;
};
function f64(v: number) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return b;
}
const i16 = (v: number) => Uint8Array.of((v >> 8) & 255, v & 255);

/** av1C from the encoder's description, or worked out from the stream's sequence header. */
export function av1Config(t: VTrack): Uint8Array | null {
  if (t.description && t.description.length >= 4 && t.description[0] === 0x81) return t.description;
  const key = t.samples.find(s => s.key);
  return key ? av1CFromStream(key.data) : null;
}

/** An WebM file holding one VP9 or AV1 track. */
export function muxWebM(t: VTrack, codec: 'vp9' | 'av1', alpha: boolean): Uint8Array {
  const S = t.samples,
    frameMs = 1000 / t.fps,
    durMs = S.length ? S[S.length - 1].ts / 1000 + frameMs : 0;
  const ebml = el(
    0x1a45dfa3,
    uintEl(0x4286, 1),
    uintEl(0x42f7, 1),
    uintEl(0x42f2, 4),
    uintEl(0x42f3, 8),
    el(0x4282, str('webm')),
    uintEl(0x4287, 4),
    uintEl(0x4285, 2),
  );
  const info = el(
    0x1549a966,
    uintEl(0x2ad7b1, 1000000),
    el(0x4489, f64(durMs)),
    el(0x4d80, str('SVGcinema')),
    el(0x5741, str('SVGcinema')),
  );
  const priv = codec === 'av1' ? av1Config(t) : null;
  const video = el(0xe0, uintEl(0xb0, t.width), uintEl(0xba, t.height), alpha ? uintEl(0x53c0, 1) : new Uint8Array(0));
  const tracks = el(
    0x1654ae6b,
    el(
      0xae,
      uintEl(0xd7, 1),
      uintEl(0x73c5, 1),
      uintEl(0x83, 1),
      uintEl(0x9c, 0),
      el(0x86, str(codec === 'av1' ? 'V_AV1' : 'V_VP9')),
      priv ? el(0x63a2, priv) : new Uint8Array(0),
      uintEl(0x23e383, Math.round(1e9 / t.fps)),
      video,
    ),
  );
  // clusters: a new one at every keyframe (and before a block's time would overflow 16 bits)
  const clusters: { time: number; bytes: Uint8Array }[] = [];
  let cur: { time: number; blocks: Uint8Array[] } | null = null;
  const flush = () => {
    if (cur) clusters.push({ time: cur.time, bytes: elFixed(0x1f43b675, uintEl(0xe7, cur.time), ...cur.blocks) });
  };
  S.forEach((s, i) => {
    const ms = Math.round(s.ts / 1000);
    if (!cur || s.key || ms - cur.time > 30000) {
      flush();
      cur = { time: ms, blocks: [] };
    }
    const rel = ms - cur.time,
      head = (flags: number) => cat([Uint8Array.of(0x81), i16(rel), Uint8Array.of(flags)]);
    if (s.alpha && s.alpha.length) {
      // a BlockGroup carries the alpha channel as BlockAdditional 1; a frame that isn't a keyframe
      // names the one before it
      const prev = i > 0 ? Math.round(S[i - 1].ts / 1000) - ms : 0;
      cur.blocks.push(
        el(
          0xa0,
          el(0xa1, head(0), s.data),
          el(0x75a1, el(0xa6, uintEl(0xee, 1), el(0xa5, s.alpha))),
          s.key ? new Uint8Array(0) : el(0xfb, i16(prev)),
        ),
      );
    } else cur.blocks.push(el(0xa3, head(s.key ? 0x80 : 0), s.data));
  });
  flush();
  // the seek head points at Info, Tracks and Cues; its own size doesn't depend on the positions
  const seekEntry = (id: number, pos: number) => el(0x4dbb, el(0x53ab, idBytes(id)), el(0x53ac, u64(pos)));
  const seekHead = (pi: number, pt: number, pc: number) =>
    el(0x114d9b74, seekEntry(0x1549a966, pi), seekEntry(0x1654ae6b, pt), seekEntry(0x1c53bb6b, pc));
  const shLen = seekHead(0, 0, 0).length,
    infoPos = shLen,
    tracksPos = infoPos + info.length;
  let pos = tracksPos + tracks.length;
  const cuePoints: Uint8Array[] = [];
  for (const c of clusters) {
    cuePoints.push(el(0xbb, uintEl(0xb3, c.time), el(0xb7, uintEl(0xf7, 1), uintEl(0xf1, pos))));
    pos += c.bytes.length;
  }
  const cues = el(0x1c53bb6b, ...cuePoints),
    body = cat([seekHead(infoPos, tracksPos, pos), info, tracks, ...clusters.map(c => c.bytes), cues]);
  return cat([ebml, idBytes(0x18538067), size8(body.length), body]);
}

/* ---------------- AV1 sequence header → av1C ---------------- */

class Bits {
  p = 0;
  constructor(private b: Uint8Array) {}
  read(n: number) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.b[this.p >> 3] || 0;
      v = v * 2 + ((byte >> (7 - (this.p & 7))) & 1);
      this.p++;
    }
    return v;
  }
  uvlc() {
    let lz = 0;
    while (!this.read(1) && lz < 32) lz++;
    return lz >= 32 ? 2 ** 32 - 1 : this.read(lz) + 2 ** lz - 1;
  }
}
function leb128(b: Uint8Array, o: number): [number, number] {
  let v = 0,
    i = 0;
  for (; i < 8; i++) {
    const x = b[o + i];
    v += (x & 0x7f) * 2 ** (7 * i);
    if (!(x & 0x80)) return [v, i + 1];
  }
  return [v, i];
}
/** Find the sequence header OBU in a keyframe and describe it as av1C. */
export function av1CFromStream(data: Uint8Array): Uint8Array | null {
  let o = 0;
  while (o < data.length) {
    const h = data[o],
      type = (h >> 3) & 15,
      ext = (h >> 2) & 1,
      hasSize = (h >> 1) & 1;
    let p = o + 1 + ext,
      len = data.length - p;
    if (hasSize) {
      const [v, n] = leb128(data, p);
      len = v;
      p += n;
    }
    if (type === 1) {
      const obu = data.subarray(o, p + len);
      const r = new Bits(data.subarray(p, p + len));
      const profile = r.read(3);
      r.read(1); // still_picture
      const reduced = r.read(1);
      let level = 0,
        tier = 0,
        decoderModel = 0,
        bufLen = 0;
      if (reduced) level = r.read(5);
      else {
        if (r.read(1)) {
          // timing info
          r.read(32);
          r.read(32);
          if (r.read(1)) r.uvlc();
          decoderModel = r.read(1);
          if (decoderModel) {
            bufLen = r.read(5) + 1;
            r.read(32);
            r.read(5);
            r.read(5);
          }
        }
        const initialDelay = r.read(1),
          ops = r.read(5) + 1;
        for (let i = 0; i < ops; i++) {
          r.read(12);
          const lv = r.read(5),
            tr = lv > 7 ? r.read(1) : 0;
          if (i === 0) {
            level = lv;
            tier = tr;
          }
          if (decoderModel && r.read(1)) {
            r.read(bufLen);
            r.read(bufLen);
            r.read(1);
          }
          if (initialDelay && r.read(1)) r.read(4);
        }
      }
      const wb = r.read(4) + 1,
        hb = r.read(4) + 1;
      r.read(wb);
      r.read(hb);
      if (!reduced && r.read(1)) {
        r.read(4);
        r.read(3);
      }
      r.read(3); // 128x128, filter intra, intra edge
      let orderHint = 0;
      if (!reduced) {
        r.read(4); // interintra, masked, warped, dual filter
        orderHint = r.read(1);
        if (orderHint) r.read(2);
        const chooseScreen = r.read(1),
          forceScreen = chooseScreen ? 2 : r.read(1);
        if (forceScreen > 0 && !r.read(1)) r.read(1);
        if (orderHint) r.read(3);
      }
      r.read(3); // superres, cdef, restoration
      const high = r.read(1),
        twelve = profile === 2 && high ? r.read(1) : 0,
        mono = profile === 1 ? 0 : r.read(1);
      let cp = 2,
        tc = 2,
        mc = 2;
      if (r.read(1)) {
        cp = r.read(8);
        tc = r.read(8);
        mc = r.read(8);
      }
      let sx = 1,
        sy = 1,
        pos = 0;
      if (mono) r.read(1);
      else if (cp === 1 && tc === 13 && mc === 0) {
        sx = 0;
        sy = 0;
      } else {
        r.read(1); // color range
        if (profile === 0) {
          sx = 1;
          sy = 1;
        } else if (profile === 1) {
          sx = 0;
          sy = 0;
        } else if (twelve) {
          sx = r.read(1);
          sy = sx ? r.read(1) : 0;
        } else {
          sx = 1;
          sy = 0;
        }
        if (sx && sy) pos = r.read(2);
      }
      return cat([
        Uint8Array.of(
          0x81,
          (profile << 5) | level,
          (tier << 7) | (high << 6) | (twelve << 5) | (mono << 4) | (sx << 3) | (sy << 2) | pos,
          0,
        ),
        obu,
      ]);
    }
    o = p + len;
  }
  return null;
}
