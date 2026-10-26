// SVGcinema — agent/busy
// Set while the design agent runs a request. Editing is paused meanwhile (the keyboard handler and
// #app.agent-busy in the CSS check it), so the request stays one clean undo step. Play, scrub and
// zoom keep working.
export const BUSY = { on: false };

export function setBusy(on: boolean) {
  BUSY.on = on;
  const app = document.getElementById('app');
  if (app) app.classList.toggle('agent-busy', on);
}
