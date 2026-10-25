// SVGcinema — core/batch-mode
// The editor working inside the standalone batch converter (tools/converter, a single HTML file kept
// apart from the site): its hidden frame sets window.__CIN_BATCH__ before the editor starts. There
// it converts files one by one and must not touch what the browser keeps for editing (the last
// project, its images, the file name, the unsaved-changes flag). index.html?batch does the same, for
// tests during development.
export const BATCH =
  typeof window !== 'undefined' &&
  (!!(window as any).__CIN_BATCH__ || /[?&]batch(=|&|$)/.test(window.location ? window.location.search : ''));
