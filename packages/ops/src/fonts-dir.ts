import { fileURLToPath } from "node:url";

/** Folder holding the bundled template fonts, for Node tools that copy them into projects. */
export const BUNDLED_FONTS_DIR = fileURLToPath(new URL("../fonts", import.meta.url));
