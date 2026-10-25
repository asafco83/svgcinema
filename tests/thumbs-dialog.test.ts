import { describe, expect, it } from 'vitest';
import { THUMB_LINKS, thumbsHTML } from '../src/ui/thumbs-dialog';

describe('Help › Thumbnails on your computer', () => {
  it('leads with the Windows installer and its warning, Linux on the small line', () => {
    const h = thumbsHTML(false);
    expect(h).toContain(THUMB_LINKS.windows);
    expect(h).toContain('Windows will warn you');
    expect(h.indexOf('data-os="windows"')).toBeGreaterThan(-1);
    expect(h.indexOf(THUMB_LINKS.windows)).toBeLessThan(h.indexOf(THUMB_LINKS.deb));
  });
  it('on Linux the Linux downloads lead and Windows moves to the small line', () => {
    const h = thumbsHTML(true);
    expect(h).toContain('data-os="linux"');
    expect(h).not.toContain('Windows will warn you');
    expect(h.indexOf(THUMB_LINKS.deb)).toBeLessThan(h.indexOf(THUMB_LINKS.windows));
  });
  it('every download opens from the fixed thumbnails release', () => {
    Object.values(THUMB_LINKS).forEach(u =>
      expect(u).toMatch(/^https:\/\/github\.com\/asafco83\/svgcinema\/releases\/.*thumbnails/),
    );
  });
});
