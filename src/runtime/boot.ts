// SVGcinema — runtime/boot
// Starts an SVG exported with Player › External: reads the JSON it carries (<script
// type="application/json" data-cin>), makes the player and wires the start trigger, as the embedded
// player's own start-up code does (export/build: triggerJS, reducedJS). Used by the external player
// file (runtime/player.ts) and by the Export dialog's preview.
import { CinEngine, type CinPlayer, type EngineData } from './engine';

/** what an exported SVG carries for the external player */
export interface BootConfig {
  /** the animation (the same data the embedded player gets) */
  d: EngineData;
  /** start trigger: load | click | hover | scroll | api */
  t?: string;
  /** what leaving does (hover, click, scroll): pause | reverse | start | restart | none */
  o?: string;
  /** the forward direction: 1, or -1 when the animation plays in reverse */
  b?: number;
  /** visitors who ask for less motion: play anyway, or show the first / last frame */
  rm?: string;
}
export type Booted = SVGSVGElement & { player?: CinPlayer; cinPlayer?: CinPlayer };

function triggers(s: Booted, P: CinPlayer & { _cleanup?: Array<() => void> }, c: BootConfig) {
  const base = c.b === -1 ? -1 : 1,
    leave = c.o || 'pause',
    cleanup: Array<() => void> = (P._cleanup = []),
    on = (t: EventTarget, e: string, f: EventListener) => {
      t.addEventListener(e, f);
      cleanup.push(() => t.removeEventListener(e, f));
    },
    fwd = () => {
      if (P.direction !== base || P.isRollingBack) P.set('direction', base);
      P.play();
    },
    out = () => {
      if (leave === 'pause') P.pause();
      else if (leave === 'reverse') P.rollback();
      else if (leave === 'start') P.stop();
      else if (leave === 'restart') P.restart();
    };
  const t = c.t || 'load';
  if (t === 'hover') {
    on(s, 'mouseenter', fwd);
    on(s, 'mouseleave', out);
  } else if (t === 'click') {
    s.style.cursor = 'pointer';
    on(s, 'click', () => {
      if (P.isPlaying && !P.isRollingBack) {
        if (leave !== 'none') out();
      } else fwd();
    });
  } else if (t === 'scroll') {
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        e => {
          if (e[0].isIntersecting) fwd();
          else if (leave !== 'none' && (P.isPlaying || P.currentTime > 0)) out();
        },
        { threshold: 0.35 },
      );
      io.observe(s);
      cleanup.push(() => io.disconnect());
    } else P.play();
  } else if (t !== 'api') P.play();
}

/** Start the animation of one exported SVG (once; later calls return its player). */
export function boot(s: Booted, c?: BootConfig): CinPlayer | null {
  if (!s) return null;
  if (s.player) return s.player;
  if (!c) {
    const el = s.querySelector('script[type="application/json"][data-cin]');
    if (!el) return null;
    try {
      c = JSON.parse(el.textContent || '');
    } catch (_) {
      return null;
    }
  }
  const P = CinEngine(c.d, s);
  s.player = s.cinPlayer = P;
  P.stop();
  const still =
    (c.rm === 'first' || c.rm === 'last') &&
    !!window.matchMedia &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) P.seekTo(c.rm === 'first' ? 0 : Math.max(0, Math.round((c.d.dur || 1) * 1000) - 1));
  else triggers(s, P, c);
  try {
    s.dispatchEvent(new CustomEvent('cinready', { detail: P }));
  } catch (_) {}
  return P;
}
/** Start every exported SVG on the page (or inside `root`) that is still waiting. */
export function scan(root: ParentNode = document) {
  root.querySelectorAll('script[type="application/json"][data-cin]').forEach(el => {
    const s = el.closest('svg') as Booted | null;
    if (s && !s.player) boot(s);
  });
}
