// SVGcinema — ui/thumbs-dialog
// Help › Thumbnails on your computer…: where to get the add-ons that show a project's first frame
// (thumbnail.png, saved in every project) as its picture in the file manager. The download for the
// system you're on leads; the others sit on a small line. Mac isn't supported, so there the menu
// item is hidden (see file-menu). The installers are built by .github/workflows/thumbnailers.yml.
import { $ } from '../core/constants';
import { IS_MAC } from '../core/keys';

const REL = 'https://github.com/asafco83/svgcinema/releases';
export const THUMB_LINKS = {
  windows: `${REL}/download/thumbnails/SVGcinema-Thumbnails-Setup.exe`,
  deb: `${REL}/download/thumbnails/svgcinema-thumbnails.deb`,
  tar: `${REL}/download/thumbnails/svgcinema-thumbnails-linux.tar.gz`,
  all: `${REL}/tag/thumbnails`,
};
const platform = () => (typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent || '' : '');
/** the add-ons exist for Windows and Linux; on a Mac the menu item is hidden */
export const thumbsAvailable = () => !IS_MAC;
export const onLinux = () => /Linux/i.test(platform()) && !/Android/i.test(navigator.userAgent || '');

const DL_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10"/></svg>';
const WARN_ICON =
  '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.5l7 3v4.5c0 4-3 6.6-7 7.5-4-.9-7-3.5-7-7.5V5.5z"/><path d="M10 7v3.5M10 13.2v.1"/></svg>';
// three invented example projects, as their thumbnails would look
const EXAMPLES: Array<[string, string]> = [
  [
    'Night intro',
    '<rect width="112" height="70" fill="#14213d"/><circle cx="78" cy="30" r="12" fill="#7189ff"/><path d="M0 54q24-14 48-4t64-6v26H0z" fill="#2b4570"/><circle cx="16" cy="12" r="1.5" fill="#fff"/><circle cx="40" cy="8" r="1" fill="#fff"/><circle cx="96" cy="10" r="1" fill="#fff"/>',
  ],
  [
    'Logo bounce',
    '<rect width="112" height="70" fill="#fff4e5"/><rect x="18" y="18" width="34" height="34" rx="8" fill="#f2b63d"/><circle cx="78" cy="35" r="17" fill="#e5484d"/>',
  ],
  [
    'Wave loader',
    '<rect width="112" height="70" fill="#e9fbf3"/><path d="M14 48c16-30 30-30 42 0s28 30 42 0" fill="none" stroke="#1f9d6b" stroke-width="5" stroke-linecap="round"/>',
  ],
];
const a = (href: string, text: string, cls = '') =>
  `<a href="${href}" target="_blank" rel="noopener"${cls ? ` class="${cls}"` : ''}>${text}</a>`;

export function thumbsHTML(linux = onLinux()) {
  const files = EXAMPLES.map(
    ([n, svg]) =>
      `<div class="th-file"><svg width="112" height="70" viewBox="0 0 112 70">${svg}</svg><span>${n}.SVGcinema</span></div>`,
  ).join('');
  const windows = `<div class="th-main" data-os="windows">
      <div class="th-dl">${a(THUMB_LINKS.windows, DL_ICON + 'Download for Windows', 'btn pri th-btn')}<span>2 MB · Windows 10 and 11</span></div>
      <div class="th-warn" role="note">${WARN_ICON}<div><b>Windows will warn you. That's expected.</b><span>The installer isn't signed, so Windows says the publisher is unknown. Choose <b>More info</b>, then <b>Run anyway</b>. It installs for you only, with no administrator rights; remove it any time in Settings › Apps.</span></div></div>
    </div>`;
  const linuxMain = `<div class="th-main" data-os="linux">
      <div class="th-dl">${a(THUMB_LINKS.deb, DL_ICON + 'Download .deb package', 'btn pri th-btn')}${a(THUMB_LINKS.tar, '.tar.gz with install script', 'btn th-btn')}</div>
      <p class="th-note">For GNOME Files, Nemo, Caja and Thunar. The .tar.gz installs with <code>./install.sh</code> (asks for your password).</p>
    </div>`;
  const alt = linux
    ? `<span class="th-k">Windows:</span>${a(THUMB_LINKS.windows, 'installer (.exe)')}`
    : `<span class="th-k">Linux:</span>${a(THUMB_LINKS.deb, '.deb package')}<span class="th-dot">·</span>${a(THUMB_LINKS.tar, '.tar.gz with install script')}`;
  return `<p class="th-intro">Every project you save carries a picture of its first frame. Add this small helper and your file manager shows it instead of a plain file icon.</p>
    <div class="th-files" aria-hidden="true">${files}</div>
    ${linux ? linuxMain : windows}
    <div class="th-alt">${alt}<span class="th-sp"></span>${a(THUMB_LINKS.all, 'All downloads', 'th-all')}</div>`;
}
export function openThumbs() {
  $('#thumbsBody').innerHTML = thumbsHTML();
  $('#mThumbs').hidden = false;
}
