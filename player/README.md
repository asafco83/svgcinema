# svgcinema-player

The player for animated SVGs made with [SVGcinema](https://asafco83.github.io/svgcinema/) and exported
with **Player › External**. Such an SVG carries only its artwork and animation, plus a tiny loader, so a
page with many animations needs the player only once.

## How an exported SVG finds the player

Once the page has loaded, the loader inside each SVG:

1. uses the page's own player, if the page has loaded one (`window.CinPlayer`);
2. otherwise loads this package from jsDelivr, at a fixed version, so files already exported never
   change:

   ```text
   https://cdn.jsdelivr.net/npm/svgcinema-player@1.2.0/cin-player.min.js
   ```

   The first SVG on the page loads it, and that one copy starts every SVG on the page.

A standalone `.svg`, or one shown with `<object>` or `<embed>`, loads its own copy. Browsers run no
scripts in an SVG shown with `<img>` or as a CSS background; export as **CSS only** for those.

## Hosting the player yourself

Download `cin-player.min.js` (from this package, or with **Download the player** in SVGcinema's Export
dialog, Embed tab) and load it once on the page, before the SVGs, which you paste into the page:

```html
<script src="/js/cin-player.min.js"></script>

<svg id="cin-svg" …>…</svg>
```

Nothing is then loaded from jsDelivr.

## API

Each animated `<svg>` gets its player as `svg.player` (also `svg.cinPlayer`), and fires `cinready`
when it is ready:

```js
const svg = document.getElementById('cin-svg');
svg.addEventListener('cinready', e => {
  const player = e.detail; // the same as svg.player
  player.on('end', ms => console.log('ended at', ms));
  player.play();
});
```

Methods (chainable): `play`, `pause`, `toggle` / `togglePlay`, `restart`, `reverse`, `rollback`,
`stop`, `seek(percent)`, `seekTo(ms)`, `seekBy(ms)`, `set(name, value)` (speed, fps, iterations,
direction, alternate, fill), `ready(fn)`, `on(events, fn, prepend)`, `off(event, fn)`, `destruct`.
Events: `play`, `pause`, `restart`, `reverse`, `stop`, `end`, `keyframe`.
State: `currentTime`, `duration`, `totalTime`, `state`, `isPlaying`, `isReversed`, `isRollingBack`,
`hasEnded`, `isInfinite`, `isAlternate`, `isBackwards`, `speed`, `fps`, `direction`, `fill`,
`iterations`.

Start triggers: on load, on mouse over, on click, on scroll into view, linked to scroll (the
animation follows the page's scroll, or that of the nearest box that scrolls; added in 1.2.0, data
format 2) and programmatic.

`window.CinPlayer` has `version`, `f` (the data format it reads: 2 since 1.2.0), `boot(svg)` (for SVGs added to the
page later by script, which doesn't run their loader) and `scan(root)`.

See LICENSE for the terms.
