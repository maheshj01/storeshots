/**
 * Vertical metrics read straight from the font file, so text sits on the
 * same baseline in every canvas implementation. Browsers and Skia disagree
 * slightly on fontBoundingBoxAscent; the file doesn't.
 */
export interface FontMetrics {
  /** Ascent and descent as fractions of the em size (descent positive). */
  ascent: number;
  descent: number;
}

export function readFontMetrics(bytes: Uint8Array): FontMetrics {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = view.getUint32(0);
  // 0x00010000 TrueType, 'OTTO' CFF, 'true' legacy Apple.
  if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) {
    throw new Error("unsupported font: only TTF and OTF files are supported");
  }
  const numTables = view.getUint16(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const name = String.fromCharCode(
      view.getUint8(rec),
      view.getUint8(rec + 1),
      view.getUint8(rec + 2),
      view.getUint8(rec + 3),
    );
    tables.set(name, view.getUint32(rec + 8));
  }
  const head = tables.get("head");
  const hhea = tables.get("hhea");
  if (head === undefined || hhea === undefined) throw new Error("font is missing head or hhea table");
  const unitsPerEm = view.getUint16(head + 18);
  let ascent = view.getInt16(hhea + 4);
  let descent = -view.getInt16(hhea + 6);
  // Honour USE_TYPO_METRICS (OS/2 fsSelection bit 7) like browsers do.
  const os2 = tables.get("OS/2");
  if (os2 !== undefined && (view.getUint16(os2 + 62) & 0x80) !== 0) {
    ascent = view.getInt16(os2 + 68);
    descent = -view.getInt16(os2 + 70);
  }
  return { ascent: ascent / unitsPerEm, descent: descent / unitsPerEm };
}
