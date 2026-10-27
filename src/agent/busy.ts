// SVGcinema — agent/busy
// Set while the design agent runs a request. Editing is paused meanwhile (the keyboard handler and
// #app.agent-busy in the CSS check it), so the request stays one clean undo step. Play, scrub and
// zoom keep working.
import { AGENT_CURSOR, CURSOR_SIZE } from './cursor';

export const BUSY = { on: false };

let cur: HTMLImageElement | null = null;
/** Is the pointer over the paused editor (not the agent panel or the top bar, which keep working)? */
function paused(t: EventTarget | null) {
  const e = t as Element | null;
  return !!e && !!e.closest && !!e.closest('#app') && !e.closest('.agent, .top, .modal');
}
function follow(e: PointerEvent) {
  if (!cur) return;
  const on = paused(e.target);
  cur.hidden = !on;
  document.getElementById('app')!.classList.toggle('agent-cursor', on);
  if (on) cur.style.transform = `translate(${e.clientX - CURSOR_SIZE / 2}px,${e.clientY - CURSOR_SIZE / 2}px)`;
}
function leave() {
  if (cur) cur.hidden = true;
  const app = document.getElementById('app');
  if (app) app.classList.remove('agent-cursor');
}

export function setBusy(on: boolean) {
  BUSY.on = on;
  const app = document.getElementById('app');
  if (app) app.classList.toggle('agent-busy', on);
  // the animated cursor: drawn in a layer over the system's (hidden while it shows); with reduced motion
  // only the system's progress cursor
  const motion = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (on && motion) {
    if (!cur) {
      cur = document.createElement('img');
      cur.id = 'agCursor';
      cur.alt = '';
      cur.setAttribute('aria-hidden', 'true');
      cur.width = cur.height = CURSOR_SIZE;
      cur.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(AGENT_CURSOR);
      cur.hidden = true;
      document.body.appendChild(cur);
    }
    document.addEventListener('pointermove', follow, true);
    document.documentElement.addEventListener('pointerleave', leave);
  } else {
    document.removeEventListener('pointermove', follow, true);
    document.documentElement.removeEventListener('pointerleave', leave);
    leave();
  }
}
