// SVGcinema — core/batch-mode
// The editor working inside the standalone batch converter (tools/converter, a single HTML file kept
// apart from the site): its hidden frame sets window.__CIN_BATCH__ before the editor starts. There
// it converts files one by one and must not touch what the browser keeps for editing (the last
// project, its images, the file name, the unsaved-changes flag). index.html?batch does the same, for
// tests during development.
export const BATCH =
  typeof window !== 'undefined' &&
  (!!(window as any).__CIN_BATCH__ || /[?&]batch(=|&|$)/.test(window.location ? window.location.search : ''));

// A practice editor (Help & tutorials › a guided tour): index.html?tour=<topic> opens that tutorial's own
// small scene and runs its tour (help/practice). It runs in a frame over the editor (the Help panel stays
// beside it) or in a lightbox on the website, and it keeps nothing: the project, its images, the file name
// and every setting stay as they were. Settings are read (it looks like the user's editor) but what it
// writes stays in memory for this visit, so the editor underneath and later visits never see it.
export const TOUR = (() => {
  if (typeof window === 'undefined' || !window.location) return '';
  const m = /[?&]tour=([a-z0-9-]+)/.exec(window.location.search);
  return m ? m[1] : '';
})();
export const PRACTICE = !!TOUR;
/** Nothing is written to the browser's storage: the batch converter's frame, or a practice editor. */
export const EPHEMERAL = BATCH || PRACTICE;

/** Storage reads see the real values; writes and removals stay in memory (this page only). */
function keepInMemory() {
  if (typeof Storage === 'undefined') return;
  const P = Storage.prototype as any,
    get = P.getItem,
    mem = new WeakMap<Storage, Map<string, string | null>>(),
    m = (s: Storage) => {
      let x = mem.get(s);
      if (!x) mem.set(s, (x = new Map()));
      return x;
    };
  P.getItem = function (this: Storage, k: string) {
    const x = m(this);
    return x.has(String(k)) ? x.get(String(k)) : get.call(this, k);
  };
  P.setItem = function (this: Storage, k: string, v: string) {
    m(this).set(String(k), String(v));
  };
  P.removeItem = function (this: Storage, k: string) {
    m(this).set(String(k), null);
  };
  P.clear = function (this: Storage) {
    const x = m(this);
    for (let i = 0; i < this.length; i++) {
      const k = this.key(i);
      if (k !== null) x.set(k, null);
    }
  };
}
if (PRACTICE) keepInMemory();
