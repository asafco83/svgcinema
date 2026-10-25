# svgcinema-player

The player for animated SVGs made with [SVGcinema](https://asafco83.github.io/svgcinema/) and exported
with **Player › External**. Such an SVG carries only its artwork and animation, and links this
script, so a page with many animations loads the player once.

```html
<script href="https://cdn.jsdelivr.net/npm/svgcinema-player@1.0.0/cin-player.min.js"></script>
```

The exporter writes that line for you. To host the player yourself, download `cin-player.min.js`
(from this package or the SVGcinema site's `downloads/` folder) and choose **Your own address** in
the export settings.

## API

Each animated `<svg>` gets its player as `svg.player` (also `svg.cinPlayer`), and fires `cinready`
when it is ready:

```js
const svg = document.getElementById('cin-svg');
svg.addEventListener('cinready', e => e.detail.play());
svg.player.pause();
svg.player.seekTo(1200);
svg.player.on('end', ms => console.log('ended at', ms));
```

Methods: `play`, `pause`, `toggle` / `togglePlay`, `restart`, `reverse`, `rollback`, `stop`,
`seek(percent)`, `seekTo(ms)`, `seekBy(ms)`, `set(name, value)` (speed, fps, iterations, direction,
alternate, fill), `ready(fn)`, `on(events, fn, prepend)`, `off(event, fn)`, `destruct`.
Events: `play`, `pause`, `restart`, `reverse`, `stop`, `end`, `keyframe`.
State: `currentTime`, `duration`, `totalTime`, `state`, `isPlaying`, `isReversed`, `isRollingBack`,
`hasEnded`, `isInfinite`, `isAlternate`, `isBackwards`, `speed`, `fps`, `direction`, `fill`,
`iterations`.

`window.CinPlayer` has `version`, `boot(svg)` and `scan(root)` for SVGs added to the page later.

See LICENSE for the terms.
