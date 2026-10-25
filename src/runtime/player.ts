// SVGcinema — runtime/player
// The external player: one script file (cin-player.min.js) that SVGs exported with Player › External
// link to instead of carrying the player inside. Published to npm as `svgcinema-player` (served by
// jsDelivr and unpkg with its version in the address) and copied into the site's downloads/ folder
// for self-hosting. Built by scripts/build-player.mjs.
//
// Each time the file runs it starts the SVG its <script> belongs to (document.currentScript), then
// any other SVG on the page still waiting for it (runtime/boot). The API is the embedded player's:
// svg.player (also svg.cinPlayer), and a "cinready" event on the <svg> when it is ready.
import { boot, scan, type Booted } from './boot';

const VERSION = typeof __PLAYER_VERSION__ === 'string' ? __PLAYER_VERSION__ : 'dev';

const me = typeof document !== 'undefined' ? (document.currentScript as Element | null) : null;
const w = window as any;
w.CinPlayer = w.CinPlayer || { version: VERSION, boot, scan };
if (me) boot(me.closest('svg') as Booted);
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan());
  else scan();
}
