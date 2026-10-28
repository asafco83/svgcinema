// SVGcinema — core/view
// Canvas view settings: snapping, grid, rulers and guides visibility. These are editor preferences
// (kept in this browser), while the guides themselves belong to the document.
export interface ViewPrefs {
  snap: boolean;
  sObjects: boolean;
  sPoints: boolean;
  sGuides: boolean;
  sGrid: boolean;
  sPixel: boolean;
  /** snap dragged keyframes to the playhead, other keyframes and 0.05 s steps (Shift inverts) */
  sKeys: boolean;
  gridFront: boolean;
  gridBack: boolean;
  /** grid cell, document units */
  grid: number;
  rulers: boolean;
  guides: boolean;
}
const KEY = 'cin-view';
export const VIEW: ViewPrefs = {
  snap: true,
  sObjects: true,
  sPoints: true,
  sGuides: true,
  sGrid: false,
  sPixel: false,
  sKeys: true,
  gridFront: false,
  gridBack: false,
  grid: 10,
  rulers: false,
  guides: true,
};
try {
  Object.assign(VIEW, JSON.parse(localStorage.getItem(KEY) || '{}'));
} catch (_) {}
const subs: Array<() => void> = [];
export function onView(fn: () => void) {
  subs.push(fn);
}
export function setView(p: Partial<ViewPrefs>) {
  Object.assign(VIEW, p);
  if (!(VIEW.grid > 0)) VIEW.grid = 10;
  try {
    localStorage.setItem(KEY, JSON.stringify(VIEW));
  } catch (_) {}
  subs.forEach(f => f());
}
