# SVGcinema website

The public website for SVGcinema: a short, pitch-first home page, and a page for each part of the product. Every
page is one self-contained HTML file (styles and script inlined), with no build tools or runtime dependencies beyond
Google Fonts; the only other files they load are the clips of the editor in `img/`. The editor is expected in an
`editor/` folder next to the home page.

| Page         | Path         | What's on it                                                                                                                      |
| ------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Home         | `index.html` | The live hero, the proof strip, the workflow, the design agent, highlights, export, fit                                           |
| Features     | `features/`  | Everything the editor does, in six groups (Draw, Style, Animate, Timing, SVG interactions, Workflow)                              |
| Design agent | `agent/`     | What the agent can do, the two ways to connect, images and vector, guard rails, privacy                                           |
| Import       | `import/`    | A clip of an animated SVG coming in; other tools, animated SVGs, adding images                                                    |
| Export       | `export/`    | Which export for what, animated SVG (embed code, image optimization), the external player, linked to scroll, video, GIF and image |
| Downloads    | `downloads/` | The thumbnail installers, the player, the Claude skill and the guide for AI assistants                                            |
| Licence      | `licence/`   | The `LICENSE` file                                                                                                                |
| Help         | `help/`      | Help & tutorials: search, Start here, every topic by group; a page per topic (`help/<topic>/`) with its steps, clips and tour     |

## Files

| File                         | What it is                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/*.html`           | One file per page: its settings in a first-line comment (path, nav, title, description), then its sections                  |
| `src/partials/`              | `layout.html` (the document around every page), `header.html`, `footer.html`                                                |
| `src/specs/*.html`           | The animated demo cards (morph, motion paths, trim path, …), shared by the pages                                            |
| `src/site.css`               | The styles of every page                                                                                                    |
| `src/site.js`                | The script of every page: each part runs only on a page that has it                                                         |
| `src/hero.svg`               | The editor's sample scene, exported from SVGcinema, that plays in the hero                                                  |
| `src/snippets.json`          | The embed code shown on the Export page, as the export dialog writes it                                                     |
| `img/`                       | Clips of the real editor, light and dark (`name.mp4` + its poster `name.webp`, `name-dark.*`), and `sunrise.webp`           |
| `clips/`                     | Files the clips use (`night-flight.svg`, the CSS-animated SVG dropped on the editor for the Import page)                    |
| `captures.py`, `clock.js`    | Record the clips from the editor (dev server), frame by frame on a clock the recorder controls, with scripted agent replies |
| `build.mjs`                  | Builds every page into `index.html` / `<path>/index.html`                                                                   |
| `help.mjs`                   | Writes the help pages from `src/help/content.json` (the editor's Help panel reads the same file)                            |
| `bundle.mjs`                 | Puts the website and the editor build together in `deploy/`, and checks every local link                                    |
| `index.html`, `*/index.html` | The built pages (generated, do not edit)                                                                                    |

Placeholders the build fills in: `{{SPEC:slug}}` (a demo card), `{{ART:slug}}` (only its animated picture, or a Features tile's own animation from `src/art/`),
`{{CLIP:name|alt|class}}` (a clip of the editor in the reader's theme: both videos, the other theme's hidden with
CSS, sized from the poster's WebP header; it plays while in view, and only the poster shows for readers who ask for
less motion), `{{CLIPONE:name|alt|class}}` (one clip for both themes), `{{ROOT}}`, `{{HOME}}`, `{{IMG}}`,
`{{EDITOR_URL}}`, `{{DL}}` (the editor's `downloads/` folder), `{{HCLIP:name|alt|class}}` (a help step's clip: the editor's own
`public/help/<name>.mp4`, loaded from the editor's folder, both themes), `{{HERO_SVG}}`, `{{HERO_KB}}`, `{{HERO_GZ}}`,
`{{PLAYER_VERSION}}`, `{{LICENCE}}`, `{{LOGO}}`. The build stops on any placeholder it doesn't know.

The logo is read from `public/brand/svgcinema-logo-white.svg` at build time, so a new logo shows up on the next build.

**Every picture of the editor is a clip of the real editor**, never redrawn, and every picture on the pages moves:
a clip, a demo card or a tile animation. When the editor's look changes, record the clips again: start the dev
server (`npx vite --port 5199`) and run `python3 site/captures.py` (or name some: `python3 site/captures.py light
talk tools`). It needs ffmpeg with libx264. `help` records the help steps' clips into `public/help/` (`help:<topic>` one
topic's): each is the guided tour's own Show me for that step, in the tutorial's practice scene, so the clips match the
tour; it also writes `public/help/<topic>.svg`, the finished scene the topic page shows as "What you'll make".

## Build

```bash
node site/build.mjs                                            # editor links → editor/
node site/build.mjs --editor=https://example.com/app/          # editor links → anywhere else
npm run build:deploy                                           # editor + website together in deploy/
npm run build:zip                                              # the full site as svgcinema-site.zip
```

`npx prettier --write site` formats the sources; the built pages and `hero.svg` are generated, so `.prettierignore`
skips them.

## Deploying

`npm run build:deploy` builds the editor and the website and puts them together in `deploy/` (git-ignored): upload
its contents to any static host. The thumbnail installers the pages link to aren't in the repository: they're in the
"thumbnails" release, and `sh site/fetch-downloads.sh` puts them in `public/downloads/` (the GitHub Pages build does
the same), so run it first. The player and the Claude skill (`svgcinema-skill.zip`) are written to the editor's
`downloads/` folder by `npm run build` (`scripts/build-player.mjs`). The bundle checks that every local link in the
pages reaches a file and stops if one doesn't. `npm run build:zip` does all of it and zips the result as
`svgcinema-site.zip`, the whole site, ready to upload. By hand: put the built pages and `img/` at the root of the
site and the editor build (`dist/` from `npm run build`) in an `editor/` folder beside them. The editor builds with
relative paths (`base: './'`), so it works from a subfolder unchanged. Both live on the same origin, so the website
and the editor share the light/dark choice (`localStorage['svgcinema:theme']`).

Every "Open the editor" link opens the editor in a new tab, so the website stays open behind it.

## What's interactive

- **Home hero:** a copy of the editor window. `hero.svg` is inlined and its own player runs it; the timeline under it
  lists the scene's real layers and keyframe times (`TRACKS` in `src/site.js`) and scrubs the player with `seekTo()`.
- **Home workflow:** draw, animate, export, scrubbed by scrolling.
- **Demo cards** (home, and the Features tiles): small looping demos drawn with SMIL or CSS. They pause while off
  screen.
- **Features › Try the keys:** pressing a tool key while it is in view lights up that key (`+` / `=` and `-` too).
  The side index follows the group in view.
- **Export:** the embed code for each framework (Next.js included), the hero file's size, and a working copy of the
  export's image panel: it draws a test photo and compresses it with the visitor's own browser encoders, the same
  ones the editor uses.
- **Home finale:** film strips that run while it is in view.
- **Help:** the hub's search filters the topics as you type (`/` jumps to it). **Do it in the editor: guided tour** opens
  the practice editor (`editor/?tour=<topic>`) in a lightbox over the page; its Exit practice (or ✕, Esc) closes it. On a
  small screen the link opens the practice editor in its own tab.

`tests/browser/site.py` checks the pages: that they are built from the current sources, that every picture exists,
that they run without errors and fit a phone, the navigation and footer, the hero, the workflow, the cards, the
quoted sizes against `src/hero.svg`, the tool keys, the embed tabs, the image demo and the download links.

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
`TRACKS` in `src/site.js` to match. The sizes the pages quote are measured from `src/hero.svg` at build time. Start
from a fresh editor (clear the site's storage) so the sample scene is the one exported, and record the clips again
(`captures.py`) and `img/sunrise.webp` (a frame of the hero at 2.4 s) if the scene's look changed.
