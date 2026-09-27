import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Development only: the live editor state, for tests and debugging from the console.
if (import.meta.env.DEV) {
  void Promise.all([import("./state/store.ts"), import("./engine/folderSync.ts")]).then(([store, sync]) => {
    (window as unknown as Record<string, unknown>).__storeshots = { useEditor: store.useEditor, useSyncStatus: sync.useSyncStatus };
  });
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}
