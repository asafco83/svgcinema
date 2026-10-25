// SVGcinema — core/batch-mode
// The editor opened by the batch converter (tools/convert.html) inside a hidden frame, as
// index.html?batch: it converts files one by one and must not touch what this browser keeps for
// the person's own editing (the last project, its images, the file name, the unsaved-changes flag).
export const BATCH = typeof location !== 'undefined' && /[?&]batch(=|&|$)/.test(location.search);
