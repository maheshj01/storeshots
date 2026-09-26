/**
 * Store screenshot rules as data. Verified September 2026 against:
 * - https://support.google.com/googleplay/android-developer/answer/9866151
 * - https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
 * Re-verify before each release; both stores change these.
 */
export const SPECS_VERIFIED = "2026-09";

export type Store = "play" | "appstore";

export interface PlayDeviceClass {
  store: "play";
  id: string;
  label: string;
  minCount: number;
  maxCount: number;
  /** Allowed aspect ratios as [long, short]; empty means any within the global rule. */
  aspects: Array<[number, number]>;
}

export interface AppStoreDeviceClass {
  store: "appstore";
  id: string;
  label: string;
  /** Accepted portrait sizes; landscape is the same sizes swapped. */
  sizes: Array<[number, number]>;
  requirement: "required" | "required-if-no-6.9" | "required-for-ipad" | "optional";
}

export type DeviceClass = PlayDeviceClass | AppStoreDeviceClass;

export const PLAY = {
  minSide: 320,
  maxSide: 3840,
  maxAspect: 2,
  formats: ["png", "jpeg"] as const,
  alpha: false,
  promotion: {
    apps: { minCount: 4, minShortSide: 1080, aspects: [[16, 9]] as Array<[number, number]> },
    games: { minCount: 3, minShortSide: 1080, aspects: [[16, 9]] as Array<[number, number]> },
  },
  classes: [
    { store: "play", id: "phone", label: "Phone", minCount: 2, maxCount: 8, aspects: [] },
    { store: "play", id: "tablet-7", label: "7-inch tablet", minCount: 4, maxCount: 8, aspects: [[16, 9]] },
    { store: "play", id: "tablet-10", label: "10-inch tablet", minCount: 4, maxCount: 8, aspects: [[16, 9]] },
    { store: "play", id: "chromebook", label: "Chromebook", minCount: 4, maxCount: 8, aspects: [[16, 9]] },
    { store: "play", id: "wear", label: "Wear OS", minCount: 1, maxCount: 8, aspects: [[1, 1]] },
    { store: "play", id: "xr", label: "Android XR", minCount: 4, maxCount: 8, aspects: [[8, 5]] },
    { store: "play", id: "tv", label: "Android TV", minCount: 1, maxCount: 8, aspects: [] },
  ] satisfies PlayDeviceClass[],
};

export const APPSTORE = {
  minCount: 1,
  maxCount: 10,
  formats: ["png", "jpeg"] as const,
  alpha: false,
  classes: [
    { store: "appstore", id: "iphone-6.9", label: "iPhone 6.9-inch", sizes: [[1320, 2868], [1290, 2796], [1260, 2736]], requirement: "required" },
    { store: "appstore", id: "iphone-6.5", label: "iPhone 6.5-inch", sizes: [[1284, 2778]], requirement: "required-if-no-6.9" },
    { store: "appstore", id: "iphone-6.3", label: "iPhone 6.3-inch", sizes: [[1179, 2556]], requirement: "optional" },
    { store: "appstore", id: "iphone-6.1", label: "iPhone 6.1-inch", sizes: [[1170, 2532]], requirement: "optional" },
    { store: "appstore", id: "iphone-5.5", label: "iPhone 5.5-inch", sizes: [[1242, 2208]], requirement: "optional" },
    { store: "appstore", id: "ipad-13", label: "iPad 13-inch", sizes: [[2064, 2752], [2048, 2732]], requirement: "required-for-ipad" },
    { store: "appstore", id: "ipad-11", label: "iPad 11-inch", sizes: [[1668, 2420]], requirement: "optional" },
    { store: "appstore", id: "ipad-10.5", label: "iPad 10.5-inch", sizes: [[1668, 2224]], requirement: "optional" },
  ] satisfies AppStoreDeviceClass[],
};

/** Target presets the editor and `init` offer. */
export const PRESETS = [
  { id: "play-phone", store: "play", device: "phone", size: [1080, 1920], label: "Play phone 1080×1920 (default)" },
  { id: "play-phone-hd", store: "play", device: "phone", size: [1440, 2560], label: "Play phone 1440×2560" },
  { id: "ios-6.9", store: "appstore", device: "iphone-6.9", size: [1320, 2868], label: "iPhone 6.9-inch (default)" },
  { id: "ipad-13", store: "appstore", device: "ipad-13", size: [2064, 2752], label: "iPad 13-inch" },
] as const;
