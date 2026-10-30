// SVGcinema — ui/theme
// Light / dark theme. Until the user picks one, the editor follows the system setting; the
// button in the top bar (right of Keyboard shortcuts) switches to the other theme and remembers
// the choice. (index.html applies a saved choice before the first paint, so there is no flash.)
// Anything drawn with colors read from CSS in script (the rulers) listens for THEME_EVENT.
export type Theme = 'light' | 'dark';
const STORE = 'svgcinema:theme';
export const THEME_EVENT = 'svgcinema:theme';

// half-filled circle; the filled half flips with the theme
const ICON_LIGHT =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 000 11z" fill="currentColor"/></svg>';
const ICON_DARK =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor"/></svg>';

/** The theme on screen now: the saved choice, else the system's. */
export function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function changed() {
  syncThemeButton();
  window.dispatchEvent(new Event(THEME_EVENT));
}
export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(STORE, t);
  } catch (_) {}
  changed();
}
export function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}
/** Show the icon and label for the theme the button would switch to. */
export function syncThemeButton() {
  const b = document.getElementById('bTheme');
  if (!b) return;
  const dark = currentTheme() === 'dark',
    label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  b.innerHTML = dark ? ICON_DARK : ICON_LIGHT;
  b.title = label;
  b.setAttribute('aria-label', label);
}
export function initTheme() {
  try {
    const t = localStorage.getItem(STORE);
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (_) {}
  document.getElementById('bTheme')?.addEventListener('click', toggleTheme);
  // following the system: when the system theme changes, update the icon and redraw
  if (typeof matchMedia === 'function')
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (!document.documentElement.dataset.theme) changed();
    });
  syncThemeButton();
}
