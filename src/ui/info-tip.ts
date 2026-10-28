// SVGcinema — ui/info-tip
// An ⓘ at the end of a section title or a row label whose tooltip holds the section's explanation
// (instead of a paragraph in the panel). It takes focus, so the text is reachable from the keyboard too.
const esc = (s: string) =>
  String(s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
const ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.3v3.6"/><circle cx="8" cy="5" r=".4" fill="currentColor"/></svg>';

/** `text`: the explanation (plain text); `about`: what it explains, for screen readers. */
export function infoTip(text: string, about: string) {
  return `<span class="itip" role="img" tabindex="0" aria-label="About ${esc(about)}: ${esc(text)}" title="${esc(text)}">${ICON}</span>`;
}
