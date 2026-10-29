# SVGcinema landing page

The public website for SVGcinema: what the editor does, and the way into it. It is one self-contained page,
`site/index.html`, with no build tools or runtime dependencies beyond Google Fonts. The editor is expected in an
`editor/` folder next to it.

## Files

| File                | What it is                                                                 |
| ------------------- | -------------------------------------------------------------------------- |
| `src/page.html`     | The page source: styles, markup and script, with `{{…}}` placeholders      |
| `src/hero.svg`      | The editor's sample scene, exported from SVGcinema, that plays in the hero |
| `src/snippets.json` | The embed code shown in the Export section, as the export dialog writes it |
| `build.mjs`         | Fills in the placeholders and writes `index.html`                          |
| `index.html`        | The built page (generated, do not edit)                                    |

The logo is read from `public/brand/svgcinema-logo-white.svg` at build time, so a new logo shows up on the next build.

## Build

```bash
node site/build.mjs                                            # editor links → editor/
node site/build.mjs --editor=https://example.com/app/          # editor links → anywhere else
npm run build:deploy                                           # editor + page together in deploy/
npm run build:zip                                              # the full site as svgcinema-site.zip
```

`npx prettier --write site` formats the sources; `index.html` and `hero.svg` are generated, so `.prettierignore`
skips them.

## Deploying

`npm run build:deploy` builds the editor and the page and puts them together in `deploy/` (git-ignored): upload its
contents to any static host. The thumbnail installers the page links to aren't in the repository: they're in the
"thumbnails" release, and `sh site/fetch-downloads.sh` puts them in `public/downloads/` (the GitHub Pages build does
the same), so run it first. The bundle checks that every local link in the pages reaches a file and stops if one
doesn't. `npm run build:zip` does all of it and zips the result as `svgcinema-site.zip`, the whole site, ready to
upload. By hand: put `site/index.html` at the root of the site and the editor build (`dist/`
from `npm run build`) in an `editor/` folder beside it. The editor builds with relative paths (`base: './'`), so it works from a subfolder unchanged.
Both live on the same origin, so the page and the editor share the light/dark choice
(`localStorage['svgcinema:theme']`).

Every "Open the editor" link opens the editor in a new tab, so the landing page stays open behind it.

## What's on the page

- **Hero:** a copy of the editor window. `hero.svg` is inlined and its own player runs it; the timeline under it
  lists the scene's real layers and keyframe times (`TRACKS` in the page script) and scrubs the player with
  `seekTo()`.
- **What it animates:** twelve small looping demos (morph, motion path, trim path, bones, gradients, masks, easing,
  filters, pins, size and corners, dash patterns, triggers and links), drawn with SMIL or CSS. They pause while off
  screen.
- **How it works:** draw, animate, export, scrubbed by scrolling.
- **Images:** importing and the export dialog's image optimization, with a working copy of its image panel. It
  draws a test photo and compresses it with the visitor's own browser encoders, the same ones the editor uses.
- **Export:** JS player vs. pure CSS, the embed code for each framework (Next.js included), and the hero file's size.
- **Import:** opening SVGs from other tools, animated SVGs (supported JS-player exports and CSS animations) as editable
  keyframes, and SVGcinema exports that carry the editable project.
- **Tools, Free, final call to action.** Pressing a tool key while the Tools section is in view lights up that key
  (`+` / `=` and `-` too); under the keys, snapping and guides, align and booleans, and number dragging.
- **Footer:** the logo (back to top) and the tagline, no links.

`tests/browser/site.py` checks the page: that `index.html` is built from the current sources, that it runs without
errors, the feature cards and sections, the quoted sizes against `src/hero.svg`, the footer, the tool keys and the
phone layout.

Motion is turned off for visitors who ask for reduced motion.

## Updating the exported content

When the sample scene or the export output changes, refresh `src/hero.svg` and `src/snippets.json` from the editor
(dev server, in the browser console):

```js
const st = await import('/src/core/state.ts');
const build = await import('/src/export/build.ts');
const snip = await import('/src/export/snippets.ts');
Object.assign(st.doc.ex, { mode: 'js', trigger: 'load', size: 'responsive', prefix: 'hero' });
copy(build.buildExport(null).code); // → src/hero.svg
st.doc.ex.prefix = 'cin';
const out = {};
for (const fw of ['html', 'react', 'next', 'vue', 'svelte', 'angular', 'api']) out[fw] = snip.snippet(fw);
st.doc.ex.mode = 'css';
out.css = snip.snippet('html');
copy(JSON.stringify(out, null, 1)); // → src/snippets.json
```

Keep the `hero` prefix: the page script finds the player at `#hero-svg`. If the scene's keyframes change, update
`TRACKS` in `src/page.html` to match, and the file sizes quoted in the Export section and under the hero
(`tests/browser/site.py` checks the Export section's sizes against `src/hero.svg`). Start from a fresh editor (clear
the site's storage) so the sample scene is the one exported.
