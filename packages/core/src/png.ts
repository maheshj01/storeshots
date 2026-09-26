/**
 * A small PNG encoder that writes 8-bit RGB (colour type 2): no alpha
 * channel at all, which is what both stores ask for. Canvas encoders in
 * browsers and Skia always write RGBA, even for opaque images.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Filters each row with whichever of None, Sub, Up or Paeth gives the
 * smallest sum of absolute values, the usual heuristic from libpng.
 */
function filterRows(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3;
  const out = new Uint8Array((stride + 1) * height);
  const candidates = [0, 1, 2, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    const prev = row - stride;
    const [none, sub, up, pth] = candidates as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
    const sums = [0, 0, 0, 0];
    for (let i = 0; i < stride; i++) {
      const x = rgb[row + i]!;
      const a = i >= 3 ? rgb[row + i - 3]! : 0;
      const b = y > 0 ? rgb[prev + i]! : 0;
      const c = y > 0 && i >= 3 ? rgb[prev + i - 3]! : 0;
      none[i] = x;
      sub[i] = x - a;
      up[i] = x - b;
      pth[i] = x - paeth(a, b, c);
      sums[0]! += none[i]! < 128 ? none[i]! : 256 - none[i]!;
      sums[1]! += sub[i]! < 128 ? sub[i]! : 256 - sub[i]!;
      sums[2]! += up[i]! < 128 ? up[i]! : 256 - up[i]!;
      sums[3]! += pth[i]! < 128 ? pth[i]! : 256 - pth[i]!;
    }
    let best = 0;
    for (let k = 1; k < 4; k++) if (sums[k]! < sums[best]!) best = k;
    const o = y * (stride + 1);
    out[o] = [0, 1, 2, 4][best]!;
    out.set(candidates[best]!, o + 1);
  }
  return out;
}

/** Encodes RGBA pixels (alpha ignored) as an RGB PNG. */
export async function encodePngRgb(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  deflate: (data: Uint8Array) => Uint8Array | Promise<Uint8Array>,
): Promise<Uint8Array> {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!;
    rgb[j + 1] = rgba[i + 1]!;
    rgb[j + 2] = rgba[i + 2]!;
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour, no alpha
  const idat = await deflate(filterRows(rgb, width, height));
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Reads width, height and colour type from a PNG header. */
export function readPngHeader(bytes: Uint8Array): { width: number; height: number; colorType: number; hasAlpha: boolean } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0) !== 0x89504e47 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") {
    throw new Error("not a PNG");
  }
  const colorType = bytes[25]!;
  return { width: v.getUint32(16), height: v.getUint32(20), colorType, hasAlpha: colorType === 4 || colorType === 6 };
}
