import { useEffect, useState } from "react";

/**
 * Object URLs for blobs, keyed by name, revoked when the blobs change or
 * the component unmounts. Created inside the effect (not in useMemo) so
 * React's mount, unmount, remount in development can't leave the page
 * holding URLs that were already revoked.
 */
export function useObjectUrls(entries: Array<[string, Blob]>): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  // Blobs are immutable, so names plus blob identities make a stable key.
  const key = entries.map(([k, b]) => `${k}\u0001${blobId(b)}`).join("\u0000");
  useEffect(() => {
    const map = new Map(entries.map(([k, b]) => [k, URL.createObjectURL(b)]));
    setUrls(map);
    return () => map.forEach((u) => URL.revokeObjectURL(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the entries
  }, [key]);
  return urls;
}

const ids = new WeakMap<Blob, number>();
let nextId = 1;
function blobId(b: Blob): number {
  let id = ids.get(b);
  if (!id) ids.set(b, (id = nextId++));
  return id;
}
