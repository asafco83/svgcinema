// SVGcinema — export/encoder.worker
// Encodes one picture to AVIF, JPEG XL or WebP with the official libraries compiled to WebAssembly
// (jSquash: libavif, libjxl, libwebp). It runs in a worker so the editor stays responsive while it
// works, and each encoder is loaded only the first time it is needed.

export interface EncodeJob {
  id: number;
  fmt: 'avif' | 'jxl' | 'webp';
  img: ImageData;
  /** 1–100 */
  q: number;
  lossless: boolean;
  /** how long the encoder searches for a smaller file */
  effort: 'fast' | 'bal' | 'small';
}
export type EncodeReply = { id: number; buf: ArrayBuffer } | { id: number; error: string };

async function encode(j: EncodeJob): Promise<ArrayBuffer> {
  if (j.fmt === 'avif') {
    const m = await import('@jsquash/avif/encode');
    const speed = j.effort === 'fast' ? 8 : j.effort === 'small' ? 4 : 6;
    return m.default(j.img, j.lossless ? { lossless: true, speed } : { quality: j.q, speed });
  }
  if (j.fmt === 'jxl') {
    const m = await import('@jsquash/jxl/encode');
    const effort = j.effort === 'fast' ? 3 : j.effort === 'small' ? 9 : 7;
    return m.default(j.img, j.lossless ? { lossless: true, effort } : { quality: j.q, effort });
  }
  const m = await import('@jsquash/webp/encode');
  return m.default(j.img, j.lossless ? { lossless: 1, quality: 100, exact: 1 } : { quality: j.q });
}

self.onmessage = async (e: MessageEvent<EncodeJob>) => {
  const j = e.data;
  try {
    const buf = await encode(j);
    (self as unknown as Worker).postMessage({ id: j.id, buf } as EncodeReply, [buf]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: j.id, error: String((err && (err as Error).message) || err) });
  }
};
