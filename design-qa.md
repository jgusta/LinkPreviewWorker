# Design QA

## Source visual truth

- Contemporary wide newspaper: `/Users/jgusta/files/local/config/codex/generated_images/01a00d14-95bd-7430-9986-6cc19ee65cb1/exec-ad826112-f837-40d1-9cd2-116bf912dc5e.png` (1487 x 1058)
- Vintage wide extra: `/Users/jgusta/files/local/config/codex/generated_images/01a00d14-95bd-7430-9986-6cc19ee65cb1/exec-65ddc636-c8f1-4496-8a34-a16df14adc2d.png` (1622 x 970)
- Color image-first portrait: `/Users/jgusta/files/local/config/codex/generated_images/01a00d14-95bd-7430-9986-6cc19ee65cb1/exec-eeda0f7f-f428-4ef0-b47e-9fdda7df72e7.png` (1044 x 1507)
- Color headline-first portrait: `/Users/jgusta/files/local/config/codex/generated_images/01a00d14-95bd-7430-9986-6cc19ee65cb1/exec-7fc08512-997e-488f-b00e-77e19b1a25be.png` (1043 x 1508)
- Monochrome image-first portrait: `/Users/jgusta/files/local/config/codex/generated_images/01a00d14-95bd-7430-9986-6cc19ee65cb1/exec-99ed9fdc-2609-493b-a499-3db9c2508d6b.png` (1043 x 1508)
- Monochrome headline-first portrait: `/Users/jgusta/files/local/config/codex/generated_images/01a00d14-95bd-7430-9986-6cc19ee65cb1/exec-2d3356e4-5f58-441e-9d61-2ddbbaa44551.png` (1043 x 1508)
- Three-column broadsheet: `/Users/jgusta/files/local/config/codex/generated_images/01a00d14-95bd-7430-9986-6cc19ee65cb1/exec-72f848e1-d9c1-45c2-9983-7dcfe24acd6e.png` (1073 x 1465)
- Special-edition tabloid: `/Users/jgusta/files/local/config/codex/generated_images/01a00d14-95bd-7430-9986-6cc19ee65cb1/exec-313e8165-7c78-4d9c-be5c-ce2fcd6215d1.png` (1073 x 1465)
- Archive extra: `/Users/jgusta/files/local/config/codex/generated_images/01a00d14-95bd-7430-9986-6cc19ee65cb1/exec-dc99b984-9560-41c7-8382-4206ef34c522.png` (1073 x 1466)

## Implementation evidence

- Desktop feature edition: `/tmp/link-preview-final-desktop.png` (1425 x 1013 capture from a 1440 x 1024 CSS viewport)
- Desktop vintage edition: `/tmp/link-preview-extra-viewport.png` (1425 x 1013 capture from a 1440 x 1024 CSS viewport)
- Desktop color portraits: `/tmp/link-preview-portrait-color.png` (1425 x 1013 capture from a 1440 x 1024 CSS viewport)
- Desktop monochrome portraits: `/tmp/link-preview-portrait-mono.png` (1425 x 1013 capture from a 1440 x 1024 CSS viewport)
- Three-column broadsheet: `/tmp/link-preview-newsstand-broadsheet-full.jpg` (860 x 1164)
- Special-edition tabloid: `/tmp/link-preview-newsstand-tabloid-full.jpg` (860 x 1151)
- Archive extra: `/tmp/link-preview-newsstand-archive-full.jpg` (860 x 1220)
- Mobile newsstand: `/tmp/link-preview-newsstand-mobile.jpg` (375 x 812 capture from a 390 x 844 CSS viewport)
- Density normalization: browser captures used device scale 1. Side-by-side boards resize the source and implementation to a shared 1100 px height while preserving aspect ratio.
- State: `https://www.cloudflare.com/`, compressed assets enabled, successful API response, all nine editions and nine live images rendered.

## Full-view comparison evidence

- `/tmp/qa-wide-modern-final.png`
- `/tmp/qa-wide-extra.png`
- `/tmp/qa-portrait-color.png`
- `/tmp/qa-portrait-mono.png`
- `/tmp/qa-newsstand-broadsheet.jpg`
- `/tmp/qa-newsstand-tabloid.jpg`
- `/tmp/qa-newsstand-archive.jpg`

Each board places a selected source mock and its browser-rendered implementation in the same image. The three new editions preserve their reference hierarchy: blackletter masthead, condensed headline, full central artwork, ruled side columns, bottom briefs, publisher mark, and tightly filled front-page rhythm.

## Focused region evidence

- `/tmp/link-preview-wide-revised.png` verifies the modern masthead, full-width headline, metadata, and full-width image order.
- `/tmp/link-preview-extra-viewport.png` verifies the vintage double-rule frame, condensed headline, two-column split, and monochrome image treatment.
- `/tmp/link-preview-portrait-color.png` and `/tmp/link-preview-portrait-mono.png` verify both portrait orders and both print treatments.
- `/tmp/link-preview-newsstand-broadsheet-full.jpg` verifies the three-column story well, faint filler rules, live monochrome artwork, and three bottom briefs.
- `/tmp/link-preview-newsstand-tabloid-full.jpg` verifies the red special-edition banner, oversized headline, full-width color artwork, and compact footer briefs.
- `/tmp/link-preview-newsstand-archive-full.jpg` verifies the sepia archive treatment, side columns, four-column footer, and double-rule signoff.
- `/tmp/link-preview-newsstand-mobile.jpg` verifies the single-column mobile adaptation and wrapped blackletter masthead.

## Required fidelity surfaces

- Fonts and typography: the new mastheads use a locally bundled UnifrakturCook display face; Impact supplies the condensed banner headlines; Georgia/Times and monospace utility type preserve the editorial and issue-line hierarchy. Desktop mastheads remain on one line and mobile mastheads wrap without clipping.
- Spacing and layout rhythm: the original six keep their established compositions. The three new 860 px front pages use narrow sidebars, a dominant central story well, compact rules, filler columns, and bottom briefs. At 390 px the document client width and scroll width both equal 375 px, so no horizontal overflow remains.
- Colors and visual tokens: the broadsheet uses warm cream and black ink, the tabloid adds a restrained red accent and full-color artwork, and the archive uses sepia paper with monochrome artwork.
- Image quality and asset fidelity: every edition uses the actual API-returned image and favicon. Print variants apply grayscale/contrast treatment to live assets; the faint filler material is decorative line work and is hidden from assistive technology.
- Copy and content: title, description, URL, site, type, image, and favicon are bound to one API response across all nine editions. Supporting filler copy is concise, coherent, and subordinate to the live story.
- Accessibility and behavior: semantic articles, headings, links, labels, visible focus indicators, reduced-motion support, descriptive image alt text, and responsive layouts remain present. The fetch flow and live asset population were exercised. Browser console warnings/errors: none.

## Comparison history

### Pass 1

- [P2] The earlier contemporary edition used a side-by-side headline/image split instead of the selected full-width hierarchy.
- Fix: changed the Gazette composition to one editorial column, increased the headline scale, and moved the image below the story metadata.

### Pass 2

- [P2] The initial newsstand implementation fell back to a script face, visibly missing the blackletter mastheads used throughout the selected concepts.
- Fix: bundled UnifrakturCook and its OFL license under `public/fonts`, then wired it through a local `@font-face`.

### Pass 3

- [P2] The corrected blackletter face wrapped the desktop masthead across two lines.
- Fix: tightened the desktop masthead size and tracking, kept it to one line, and explicitly restored wrapping for the mobile breakpoint.
- Post-fix evidence: `/tmp/qa-newsstand-broadsheet.jpg`, `/tmp/qa-newsstand-tabloid.jpg`, and `/tmp/qa-newsstand-archive.jpg`. No actionable P0, P1, or P2 differences remain.

## Follow-up polish

- [P3] Paper grain remains restrained so arbitrary live preview imagery and small text stay readable.
- [P3] The source mocks use illustrative Cloudflare artwork; the implementation intentionally shows the current API-returned OG image, so image composition varies by tested URL while the editorial frame remains stable.

## Implementation checklist

- [x] Nine designs render from one live response.
- [x] All three selected filled-front-page concepts are implemented.
- [x] Faint filler rules and supporting newspaper copy fill the secondary columns.
- [x] Blackletter typography is bundled locally with its license.
- [x] Desktop and mobile layouts have no horizontal overflow.
- [x] Primary fetch flow and error console were checked.
- [x] Type generation, typecheck, 14 tests, and Wrangler dry-run pass.

final result: passed
