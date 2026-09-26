/** Drops the alpha from a #hex colour, for the opaque base every render starts from. */
export function opaque(hex: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex);
  if (!m) throw new Error(`expected a #hex colour, got ${hex}`);
  const v = m[1]!;
  if (v.length === 3) return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
  return `#${v.slice(0, 6)}`;
}
