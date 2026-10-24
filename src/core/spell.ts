// SVGcinema — core/spell
// Spell check for the text you type (the inspector's text box and typing on the canvas): the browser's
// own checker, in the browser's language. Help ▸ Spell check turns it off or on; remembered in this
// browser, on by default.
const KEY = 'svgcinema:spell';
let on = true;
try {
  on = localStorage.getItem(KEY) !== '0';
} catch (_) {}
export const spellOn = () => on;
export function setSpell(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch (_) {}
  document.querySelectorAll<HTMLTextAreaElement>('#g-text, .cin-tedit').forEach(t => (t.spellcheck = v));
}
