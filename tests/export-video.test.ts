import { beforeEach, describe, expect, it } from 'vitest';
import { doc, setDoc } from '../src/core/state';
import { sampleDoc } from '../src/model/sample';
import { av1CFromStream, muxMP4, muxWebM } from '../src/export/mux';
import type { VTrack } from '../src/export/mux';
import {
  artRect,
  codecString,
  estimate,
  frameCount,
  frameSize,
  quantizer,
  span,
  videoSettings,
  videoSnippet,
} from '../src/export/video';
import type { VideoSettings } from '../src/model/types';

beforeEach(() => setDoc(sampleDoc()));

const vs = (o: Partial<VideoSettings>): VideoSettings => ({ ...videoSettings(), ...o });

/** The boxes of an MP4, as [type, start, size], top level or inside a parent's body. */
function boxes(b: Uint8Array, from = 0, to = b.length) {
  const out: [string, number, number][] = [];
  for (let o = from; o + 8 <= to; ) {
    const size = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0,
      type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    out.push([type, o, size]);
    if (size < 8) break;
    o += size;
  }
  return out;
}
const track = (n: number, keyEvery = 30): VTrack => ({
  width: 320,
  height: 200,
  fps: 30,
  description: Uint8Array.of(1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 0),
  samples: Array.from({ length: n }, (_, i) => ({
    data: Uint8Array.of(0, 0, 0, 2, 9, i & 255),
    key: i % keyEvery === 0,
    ts: Math.round((i * 1e6) / 30),
  })),
});

describe('Export › Video: settings', () => {
  it('frame sizes come from the presets, in even pixels', () => {
    expect(frameSize(vs({ preset: '1080' }))).toEqual([1920, 1080]);
    expect(frameSize(vs({ preset: 'story' }))).toEqual([1080, 1920]);
    expect(frameSize(vs({ preset: 'doc' }), 641, 401)).toEqual([642, 402]);
    expect(frameSize(vs({ preset: 'c', w: 333, h: 211 }))).toEqual([334, 212]);
  });
  it('the part and the frame count', () => {
    expect(span(vs({ part: false }), 3)).toEqual([0, 3]);
    expect(span(vs({ part: true, from: 0.5, to: 2.5 }), 3)).toEqual([0.5, 2.5]);
    expect(frameCount(vs({ part: true, from: 0.5, to: 2.5, fps: 30 }), 3)).toBe(60);
  });
  it('Fit leaves bars, Fill crops', () => {
    expect(artRect(vs({ fit: 'fit' }), 1920, 1080, 640, 400)).toEqual({ x: 96, y: 0, w: 1728, h: 1080 });
    expect(artRect(vs({ fit: 'fill' }), 1920, 1080, 640, 400)).toEqual({ x: 0, y: -60, w: 1920, h: 1200 });
  });
  it('quality maps to the codec’s quantizer (lower is sharper)', () => {
    expect(quantizer(100, 'h264')).toBe(14);
    expect(quantizer(0, 'h264')).toBe(51);
    expect(quantizer(70, 'vp9')).toBeLessThan(quantizer(40, 'vp9'));
  });
  it('H.264 levels fit the size and rate', () => {
    expect(codecString('h264', 1280, 720, 30)).toBe('avc1.64001f');
    expect(codecString('h264', 1920, 1080, 30)).toBe('avc1.640028');
    expect(codecString('h264', 1920, 1080, 60)).toBe('avc1.64002a');
  });
  it('the estimate follows the aim', () => {
    expect(estimate(vs({ fmt: 'mp4', aim: 'size', mb: 3 }), 1920, 1080, 90)).toBe(3e6);
    expect(estimate(vs({ fmt: 'mp4', aim: 'rate', mbps: 4 }), 1920, 1080, 90)).toBe(1.5e6);
    expect(estimate(vs({ fmt: 'webm', codec: 'av1', aim: 'q' }), 1920, 1080, 90)).toBeLessThan(
      estimate(vs({ fmt: 'mp4', aim: 'q' }), 1920, 1080, 90),
    );
  });
  it('the embed code: muted, looping, both formats and a poster', () => {
    const s = videoSnippet('Sunrise badge', 640, 400, true, true, true);
    expect(s).toContain('autoplay muted loop playsinline');
    expect(s).toContain('poster="Sunrise%20badge-poster.webp"');
    expect(s.indexOf('video/webm')).toBeLessThan(s.indexOf('video/mp4'));
  });
});

describe('Export › Video: the MP4 file', () => {
  it('ftyp, then moov (fast start), then mdat with every frame', () => {
    const t = track(45),
      f = muxMP4(t),
      top = boxes(f);
    expect(top.map(b => b[0])).toEqual(['ftyp', 'moov', 'mdat']);
    expect(top[2][2]).toBe(8 + 45 * 6);
    // the chunk offset points at the first frame's bytes
    const moov = f.subarray(top[1][1], top[1][1] + top[1][2]);
    const i = String.fromCharCode(...moov).indexOf('stco');
    const off = ((moov[i + 12] << 24) | (moov[i + 13] << 16) | (moov[i + 14] << 8) | moov[i + 15]) >>> 0;
    expect(off).toBe(top[2][1] + 8);
    expect(f.subarray(off, off + 6)).toEqual(t.samples[0].data);
  });
  it('lists the keyframes and the size of every frame', () => {
    const f = muxMP4(track(61, 30)),
      s = String.fromCharCode(...f),
      i = s.indexOf('stss'),
      n = ((f[i + 8] << 24) | (f[i + 9] << 16) | (f[i + 10] << 8) | f[i + 11]) >>> 0;
    expect(n).toBe(3);
    expect(s).toContain('avcC');
    expect(s).not.toContain('ctts');
  });
  it('frames shown in another order than decoded get composition offsets', () => {
    const t = track(4);
    // decoding order I P B B → shown 0, 3, 1, 2
    [0, 3, 1, 2].forEach((p, i) => (t.samples[i].ts = Math.round((p * 1e6) / 30)));
    const s = String.fromCharCode(...muxMP4(t));
    expect(s).toContain('ctts');
  });
});

describe('Export › Video: the WebM file', () => {
  it('EBML header, then a segment with seek head, info, tracks, clusters and cues', () => {
    const f = muxWebM(track(61, 30), 'vp9', false),
      s = String.fromCharCode(...f);
    expect([f[0], f[1], f[2], f[3]]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(s).toContain('webm');
    expect(s).toContain('V_VP9');
    // one cluster per keyframe, each with a cue
    const count = (id: number[]) => {
      let n = 0;
      for (let i = 0; i + id.length <= f.length; i++) if (id.every((b, k) => f[i + k] === b)) n++;
      return n;
    };
    expect(count([0x1f, 0x43, 0xb6, 0x75])).toBe(3);
    // the cues, and the seek head's pointer to them
    expect(count([0x1c, 0x53, 0xbb, 0x6b])).toBe(2);
  });
  it('the duration is written (players can show and seek it)', () => {
    const f = muxWebM(track(30), 'vp9', false);
    const i = f.findIndex((b, k) => b === 0x44 && f[k + 1] === 0x89);
    const dur = new DataView(f.buffer, f.byteOffset + i + 3, 8).getFloat64(0);
    expect(dur).toBeCloseTo(1000, 0);
  });
  it('alpha goes into BlockAdditions', () => {
    const t = track(3);
    t.samples.forEach(x => (x.alpha = Uint8Array.of(7, 7)));
    const f = muxWebM(t, 'vp9', true);
    expect(f.some((b, k) => b === 0x75 && f[k + 1] === 0xa1)).toBe(true);
    expect(f.some((b, k) => b === 0x53 && f[k + 1] === 0xc0)).toBe(true);
  });
  it('AV1: av1C from the sequence header', () => {
    // a reduced-still-picture sequence header: profile 0, level 8
    const seq = Uint8Array.of(0x0a, 0x0b, 0b00011_000 | 0, 0b01000_000 | 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    // OBU header (type 1, has size), size 11, then the payload above from byte 2
    const c = av1CFromStream(seq);
    expect(c && c[0]).toBe(0x81);
  });
});
