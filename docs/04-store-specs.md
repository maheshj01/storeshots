# 04 Store specs

The exporter enforces these rules. They live as data in `packages/stores`
and are re-verified before each release, because both stores change them.
Verified September 2026 from the sources at the bottom.

## Google Play

Screenshots:

| Rule | Value |
|---|---|
| Format | JPEG or 24-bit PNG, no alpha |
| Side length | 320 px minimum, 3840 px maximum |
| Aspect | Longest side at most twice the shortest |
| Phone | At least 2 screenshots across device types |
| 7-inch and 10-inch tablet | At least 4 each, 9:16 portrait or 16:9 landscape |
| Chromebook | At least 4, 16:9 or 9:16 |
| Wear OS | At least 1, 1:1 |
| Android XR | 4 to 8, 8:5 |
| Android TV | At least 1 |

Eligibility for promotion and recommendations:

| | Rule |
|---|---|
| Apps | At least 4 screenshots, 1080 px minimum, 9:16 portrait (1080 by 1920 or larger) or 16:9 landscape (1920 by 1080 or larger) |
| Games | At least 3 landscape at 1920 by 1080 or 3 portrait at 1080 by 1920 |

Other listing graphics:

| Asset | Size | Format |
|---|---|---|
| Feature graphic | 1024 by 500 | JPEG or 24-bit PNG, no alpha |
| App icon | 512 by 512 | 32-bit PNG with alpha, max 1024 KB |

Default Play phone target: **1080 by 1920**, which is valid and
promotion-eligible. A 1440 by 2560 option exists for sharper output.

## Apple App Store

| Rule | Value |
|---|---|
| Count | 1 to 10 per device size |
| Format | JPEG or PNG, no alpha or transparency |

iPhone:

| Display | Accepted portrait sizes | Status |
|---|---|---|
| 6.9 inch | 1320 by 2868, 1290 by 2796, 1260 by 2736 | Provide this. Smaller sizes are scaled from it |
| 6.5 inch | 1284 by 2778 | Required only if 6.9 inch isn't provided |
| 6.3 inch | 1179 by 2556 | Optional, scaled if absent |
| 6.1 inch | 1170 by 2532 | Optional, scaled if absent |
| 5.5 inch | 1242 by 2208 | Optional, scaled if absent |

iPad:

| Display | Accepted portrait sizes | Status |
|---|---|---|
| 13 inch | 2064 by 2752, 2048 by 2732 | Required if the app runs on iPad |
| 11 inch | 1668 by 2420 | Optional |
| 10.5 inch | 1668 by 2224 | Optional |

Landscape sizes are the same dimensions swapped. Mac, Apple TV, Vision Pro
and Apple Watch have their own sizes and are out of scope until phase 3.

Default App Store targets: **iPhone 6.9 inch at 1320 by 2868** and, when
enabled, **iPad 13 inch at 2064 by 2752**. Apple scales the rest.

## What the exporter does with this

- Flattens transparency onto the background colour before writing, since
  both stores reject alpha in screenshots.
- Blocks export of any image outside size or aspect rules, with the rule
  named in the error.
- Warns, without blocking, when a Play set misses promotion eligibility.
- Writes fastlane-compatible folders:
  `metadata/android/<locale>/images/phoneScreenshots/` for Play and
  `screenshots/<locale>/` for the App Store.

## Sources

- [Google Play: preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)
- [App Store Connect: screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
