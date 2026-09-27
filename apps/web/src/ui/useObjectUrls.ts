import { useEffect, useState } from "react";

/**
 * Object URLs for blobs, keyed by name, revoked when the blobs change or
 * the component unmounts. Created inside the effect (not in useMemo) so
 * React's mount, unmount, remount in development can't leave the page
 * holding URLs that were already revoked.
 */
export function useObjectUrls(entries: Array<[string, Blob]>): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  // Blobs are immutable, so their identities are a stable dependency.
  const key = entries.map(([k]) => k).join("\u0000");
  const blobs = entries.map(([, b]) => b);
  useEffect(() => {
    const map = new Map(entries.map(([k, b]) => [k, URL.createObjectURL(b)]));
    setUrls(map);
    return () => map.forEach((u) => URL.revokeObjectURL(u));
  }, [key, ...blobs]);
  return urls;
}
