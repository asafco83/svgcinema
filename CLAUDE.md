# SVGcinema — notes for Claude

SVGcinema (formerly Keyline) is a browser SVG animation editor modelled on SVGator. You draw or import artwork, animate
properties on a timeline, and export one self-contained animated `.svg` (a JS player inside it, or
pure CSS). Live site: https://asafco83.github.io/svgcinema/ (GitHub Pages, deployed from `master`).

`README.md` is the user-facing feature list; keep it up to date with every feature.
`featureSuggestions.md` lists features that are planned but not built yet.
**Source maps:** the GitHub Pages build keeps them (`sourcemap: true` in `vite.config.ts`, for debugging there), but the
hosting zip (`npm run build:deploy`, `site/bundle.mjs`) must never include any `*.map`: they would expose the full source.
`LICENSE`: proprietary, all rights reserved (package.json `"license": "UNLICENSED"`). It lets people use
the published app, and use their exported files (with the embedded player) for any purpose,
including commercially, and load or host the external player file unmodified to play them. The owner keeps the
unilateral right to modify the terms, revoke permissions and change or end access. Earlier versions were PolyForm Noncommercial 1.0.0; the owner may reopen it later.

## How we work (the owner's workflow)

For every feature or fix:

1. Branch from `master` (`feat/…`, `fix/…`, `chore/…`) and implement.
2. Run the checks:
   - `npx prettier --write src tests` (CI fails on formatting; CI runs `prettier --check .`, so also
     format `index.html` and `README.md` when you touch them), `npx tsc --noEmit -p .`, `npx vitest run`
   - the browser tests: `tests/browser/run.sh` (see below); add or update a browser test for the change.
3. Update `README.md` when behaviour changes.
4. Commit, push, open a PR with `gh api repos/asafco83/svgcinema/pulls …`, wait for CI to pass, then
   merge with `merge_method=merge`.
5. Wait for the "Deploy to GitHub Pages" run for the merge commit, then check the live site.
   On the live site **only inspect** (load it, check the new code/UI is there); never change the
   owner's project there (it lives in that browser's storage). The workspace shell can't reach
   github.io; use the built-in browser (the owner approves access) and read the page with
   `find` / `read_page` rather than clicking. Toggling the theme there also counts as a change.
   After merging, GitHub deletes the remote branch: switch the local checkout to `master` and pull.
6. Report back briefly: what changed, what was tested, anything left open.

Commit messages end with the attribution lines the session asks for (Co-Authored-By / session URL).
PR bodies end with the "Generated with Claude Code" line and the session URL.

## The owner's UI preferences

- If a control doesn't apply, **hide it**. Exception: the layer action buttons (Layers panel) grey out.
- Ask questions when a request is ambiguous; propose a recommendation with the question.
- Reference images are often SVGator screenshots: match the behaviour, keep SVGcinema's own look.
- Keyboard shortcuts must not clash: check `src/ui/keyboard.ts` and `src/ui/view-menu.ts` first.
- For visual changes, the owner wants a **mockup first** (a Design canvas artifact, "Keyline UI
  refresh", from before the rename), iterated on and approved before implementing; then the app must **match the mockup
  closely** (sizes, spacing, icons, layout). Check by screenshotting the app at the same size and state
  as the mockup and comparing side by side, not from memory.
- Every animatable property keeps its **own row and ◆ toggle** (e.g. fill colour and fill opacity are
  separate rows). Never drop existing functionality when restyling (booleans, Appearance, Filters…).
- Icons should read clearly at small sizes; prefer Adobe-like metaphors (e.g. line ends / joins drawn as
  the stroke shape with the path knocked out).

**Name:** the app is **SVGcinema** (formerly Keyline), everywhere, including internals: projects are
`.SVGcinema` files (a zip with format `svgcinema-project`; the fallback download is `.SVGcinema.zip`),
storage keys and events are `svgcinema:*`, exported ids use the `cin-` prefix, the runtime is
`CinEngine` / `CinPlayer`, and the repo is `asafco83/svgcinema`. Old Keyline files and settings are not
read (no backward compatibility, by the owner's choice). The logo is inlined in `index.html`
(`.brand .logo`); its colours are the `--logo-a` / `--logo-b` tokens (black version in the light theme,
white in the dark). The source files are in `public/brand/`.

## Stack and layout

Vite 5 + TypeScript (strict), no framework (DOM strings + event delegation). Vitest + happy-dom for
unit tests. `paper` (booleans, lazy-loaded) and `opentype.js` (text to outlines) are the only runtime deps.

- `src/runtime/engine.ts` — **CinEngine**, the animation runtime. It is self-contained (no imports)
  because it is serialised into the exported SVG; the editor also uses it (`H` in `core/constants`).
  Write it in plain ES5-style code (`var`, `function`), like the rest of the file.
- `src/model/` — data types (`types.ts`), layer tree, filters, fonts, sample document.
- `src/core/` — state (`S` UI state, `doc` document), history (`beginEdit()` → `ed.end({insp:true})`
  is one undo step), keyframes, masks, booleans, view prefs.
- `src/render/` — stage (renders the document with the engine), overlay (selection handles, drawn
  in document coordinates into `#overlay`), markup (SVG strings), guides/rulers, text layout, fonts.
- `src/tools/` — canvas interaction: `stage-input.ts` routes pointer events (handles use `data-*`
  attributes like `data-h`, `data-node`, `data-gh`, `data-mh`); a drag is `S.drag = {move, up}`.
- `src/ui/` — panels and menus: `inspector.ts` + `props-panel.ts` (right panel), `timeline.ts`,
  `layers-panel.ts`, `layer-menu.ts` (right-click), `color-picker.ts` (the colour window), …
- `src/export/build.ts` — export (JS or CSS mode), `dialog.ts` the Export dialog.
- `src/io/` — open/save `.SVGcinema` projects (zip), SVG import, assets.
- `src/agent/` — the design agent (in-app AI chat, being built in steps; spec: the "SVGcinema design agent — tool
  spec" doc). `tools.ts` = the tools a model calls, each a thin wrapper over an editor function (never edit `doc`
  by hand where one exists); `scene.ts` = the scene summary; `request.ts` = one request = one undo step (tools'
  own undo entries are folded into one); `schema.ts` = argument checks; `loop.ts` = runs a request (tool calls
  one by one, step cap, Stop, provider errors); `clients/` = streaming OpenAI-compatible and Anthropic clients
  (called from the browser with the user's key); `providers.ts` = the provider table and `makeClient`;
  `prompt.ts` = the system prompt and the scene attached to each message; `settings.ts` = provider, model and keys
  (browser storage only); `chat.ts` = the chat (saved in the project as `agent-chat.json` through `io/extras.ts`);
  `describe.ts` = how a step reads in the panel; `busy.ts` = editing paused while a request runs. The panel is
  `ui/agent-panel.ts` (Alt+A, docked as the grid's fifth column). Tested by `tests/agent.test.ts`,
  `tests/agent-loop.test.ts` (mocked `fetch`), `tests/browser/agent-tools.py`, `tests/browser/agent-loop.py` and `tests/browser/agent-panel.py`
  (Playwright answers the provider URLs with scripted streams). Tests never call a real model provider.

## UI conventions (from the UI refresh)

- **Look:** panels sit flush, split by hairlines (`--line`); colour tokens live on `:root` in
  `src/styles/app.css`, with a dark set under `prefers-color-scheme` and `[data-theme='dark']`. Use the
  tokens (`--panel`, `--panel-2`, `--raised`, `--line`, `--line-2`, `--line-soft`, `--fg`, `--muted`,
  `--accent`, `--accent-fg`, `--accent-soft`, `--accent-line`, `--key`, `--key-text`, `--key-soft`,
  `--head`, `--mat`, `--dot`, `--shade`, `--shade-sm`), never raw colours. Later rules for the refresh
  are appended near the end of `app.css` ("UI refresh: details matched to the mockup", …).
- **Fonts:** `--f-ui` Instrument Sans for everything, `--f-mark` Instrument Serif for the wordmark,
  `--f-num` = Instrument Sans with `tabular-nums` (set on `body`) for numbers, `--f-code` JetBrains Mono
  only for code views. Don't put numbers back in JetBrains Mono: its dotted zero reads as an 8 at small
  sizes, and the Google Fonts build has no slashed-zero alternate.
- **Theme:** `src/ui/theme.ts`. The button `#bTheme` is in the top bar right of `#bKeys`; the choice is
  saved in `localStorage['svgcinema:theme']` and applied before first paint by an inline script in
  `index.html`. Anything that paints with colours read from CSS in script (the rulers in
  `render/guides.ts`) must listen for `THEME_EVENT` and repaint.
- **Sliders** draw a filled track from the CSS variable `--p`; `src/ui/ranges.ts` keeps it in step
  (user input, programmatic `.value`, and sliders added by re-renders), so no per-slider code is needed.
- **Inspector:** a header (`.insp-head`: layer name `#ln` + type chip) above the align / boolean bar.
  Section headings can collapse: `applyCollapse()` appends a `.sec-tg` button to each `.sec > h3`
  (last in the DOM, shown first via CSS `order`) so the heading's **first text node stays the title**
  (tests read `h3.childNodes[0]`). Closed sections are remembered in `svgcinema:inspClosed`.
  `krow()` rows have a ◆ (`.kb`: grey = off, `.has` = animated, amber label; `.on` = key at playhead);
  `nrow()` rows are indented to line up with them. Colour fields (`colf`): swatch + value in one
  `.cbox`, eyedropper beside it.
- **Hint:** the tool tips are behind the `#hintBtn` "?" in the canvas HUD; set them with
  `$('#hint').innerHTML = hintHTML(HINTS[t])` (splits on " · ", key names become `<kbd>`).
- **Layers panel:** rows carry dotted tree guides (`.lp-guides`, computed per row in `renderLayers`)
  and a clip hook (`.lp-clip`) on layers a mask / clip folder applies to. Action bar order: Up, Down |
  Duplicate, Ungroup, Group, Release mask, Create mask, Delete (right) — `layer-actions.py` asserts it.
- **Class-name pitfall:** `sel` is the _selected_ state class on layer rows, timeline rows, keyframes
  and gradient stops, so dropdown styles must be written as `select.sel`, never bare `.sel`.

## Data model essentials

- A layer has base values `layer.b` and tracks `layer.t`: `t[prop] = [[time, value, ease, curve?, nodeType?], …]`.
- `setProp(l, k, v)` adds/updates a keyframe **only if that property already has a track**; otherwise it
  sets the base value. (There is no auto-key button.) Frozen tracks move to `layer.ft`.
- Paint values: a colour string, `'none'`, or a gradient
  `{g:'lin'|'rad', s:[[offset 0–1, colour]…], a?, p?:[x1,y1,x2,y2], cx?, cy?, r?, ra?, rr?}` in the
  shape's bounding-box units. Engine helpers: `isG`, `mixG`, `gAttrs`, `linP`, `paint`.
- Trim path: props `ts`, `te`, `to` (%), drawn with `pathLength=100` and `trimDash()`.
- CSS export can't animate everything (e.g. gradients only animate stop colours/opacity there); the JS
  export animates everything.

## Tests

- **Unit:** `npx vitest run` (`tests/*.test.ts`). `tests/output.test.ts` compares the export of a
  sample against `tests/fixtures/export-sample.json`: new options must keep default output identical.
  Regenerate deliberately with `UPDATE_FIXTURES=1 npx vitest run tests/output.test.ts`.
- **Browser:** `tests/browser/*.py` (Playwright for Python + Chromium). `tests/browser/run.sh` runs
  them all (or `run.sh color-picker gradient-handles` for some). Each prints a JSON report and a final
  `FAILS [...]` line. Feature tests drive a dev server on port 5199 and import modules directly
  (`await import('/src/core/state.ts')`); `smoke.py` clicks through the whole editor on a production build.
- **Pitfall:** after editing source files, restart the dev server before browser tests (`run.sh`
  does this). A long-running Vite server can hand dynamic imports duplicate module instances, and then
  `st.doc` is undefined in tests.
- **Pitfall:** clicking the exact centre of a selected shape hits the origin handle; tests grab shapes
  off-centre.
- `tests/browser/ui-refresh.py` covers the refreshed UI (theme toggle and ruler repaint, inspector
  header / collapsing / ◆ states, colour field, units, hint, slider fill, Animate button…); extend it
  for UI changes. To add a layer to the selection in tests use `hi.select(id, 'toggle')` (there is no
  `'add'` mode).
- The sample scene (`src/model/sample.ts`) is a tour of every feature and the browser tests run on it.
  In tests, pick sample layers **by name** (`l.name==='Title'`), never "the first ellipse / text / mask",
  and keep the names and order its header comment lists. `tests/sample.test.ts` checks it still
  showcases everything; when you add a feature, add it to the sample and that test.
- **Pitfall (own screenshots):** when starting a dev server yourself for screenshots, run it in its
  own process group (`setsid`) and stop the group; killing `npx` leaves `vite` running on the port, and
  `pkill -f "vite …"` can match the calling shell's own command line and kill it.
