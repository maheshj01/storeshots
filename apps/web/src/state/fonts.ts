/**
 * Bundled template fonts, served at /fonts/ from packages/ops/fonts by the
 * Vite config, and copied into a project when a template or layer uses them.
 */
const bundled = new Map<string, Promise<Blob>>();

export async function fetchBundledFonts(files: string[]): Promise<Array<[string, Blob]>> {
  return Promise.all(
    files.map(async (f) => {
      // One Blob per font for the session, so it's decoded and registered once.
      let p = bundled.get(f);
      if (!p) {
        p = fetch(`/fonts/${f}`).then((r) => {
          if (!r.ok) throw new Error(`could not load bundled font ${f}`);
          return r.blob();
        });
        p.catch(() => bundled.delete(f));
        bundled.set(f, p);
      }
      return [`fonts/${f}`, await p] as [string, Blob];
    }),
  );
}
