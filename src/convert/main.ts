// SVGcinema — batch converter (tools/converter)
// Turns many SVGs (SVGator exports, CSS-animated SVGs, plain artwork) into .SVGcinema projects. A
// standalone tool, kept apart from the site: `npm run build:converter` makes one HTML file,
// SVGcinema-Converter.html, that carries the whole editor inside it and works opened from disk.
// The work is done by that editor in a hidden frame (io/batch.ts, core/batch-mode.ts): each file goes
// through its Open SVG and Save, so a project comes out exactly as it would by hand, first-frame
// thumbnail included, and nothing is kept in the browser.
import './convert.css';
import type { BatchResult } from '../io/batch';

/** the editor, built as one HTML file (tools/converter/build.mjs); empty in development */
declare const __EDITOR_HTML__: string;
const EDITOR = typeof __EDITOR_HTML__ === 'string' ? __EDITOR_HTML__ : '';
/** the editor's page with a script that runs before it starts */
const editorWith = (flag: string) => EDITOR.replace(/<head>/i, `<head><script>window.${flag}=1<\/script>`);

type Status = 'wait' | 'run' | 'done' | 'notes' | 'fail' | 'skip';
interface Row {
  id: number;
  file: File;
  /** where it came from, for the list (folder/name.svg) */
  path: string;
  status: Status;
  r?: BatchResult;
  /** the project file name it was saved under */
  out?: string;
  why?: string;
}
type Exists = 'skip' | 'replace' | 'both';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const canFolder = typeof (window as any).showDirectoryPicker === 'function';

let rows: Row[] = [],
  nextId = 1,
  running = false,
  paused = false,
  out: 'folder' | 'zip' = canFolder ? 'folder' : 'zip',
  dir: any = null,
  exists: Exists = 'skip',
  zipBlob: Blob | null = null;
const SHOW = 200; // rows drawn at once; the rest are summed up below the list

// ------------------------------------------------------------------------------------- the editor

let frame: HTMLIFrameElement,
  api: { convert: (n: string, t: string, title: boolean) => Promise<BatchResult>; zipAll: (f: any[]) => Promise<Blob> };
let ready: Promise<void>;
function loadEditor() {
  frame = document.createElement('iframe');
  frame.id = 'frame';
  frame.title = 'SVGcinema editor (working in the background)';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  ready = new Promise(res => {
    const wait = () => {
      const b = frame.contentWindow && (frame.contentWindow as any).cinBatch;
      if (b) {
        api = b;
        res();
      } else setTimeout(wait, 100);
    };
    wait();
  });
  // the built tool carries the editor; during development the dev server's editor is used
  if (EDITOR) frame.srcdoc = editorWith('__CIN_BATCH__');
  else frame.src = new URL('/index.html?batch', location.href).href;
  document.body.appendChild(frame);
}

// ------------------------------------------------------------------------------------- adding files

const isSVG = (f: File) => /\.svg$/i.test(f.name) || f.type === 'image/svg+xml';
function add(files: Array<{ file: File; path: string }>) {
  const known = new Set(rows.map(r => r.path + ':' + r.file.size + ':' + r.file.lastModified));
  files
    .filter(x => isSVG(x.file))
    .forEach(x => {
      const k = x.path + ':' + x.file.size + ':' + x.file.lastModified;
      if (known.has(k)) return;
      known.add(k);
      rows.push({ id: nextId++, file: x.file, path: x.path, status: 'wait' });
    });
  zipBlob = null;
  render();
}
async function readEntry(entry: any, prefix: string, outList: Array<{ file: File; path: string }>) {
  if (entry.isFile) {
    const f: File = await new Promise((res, rej) => entry.file(res, rej));
    outList.push({ file: f, path: prefix + f.name });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    let batch: any[] = [];
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const e of batch) await readEntry(e, prefix + entry.name + '/', outList);
    } while (batch.length);
  }
}
async function fromDrop(dt: DataTransfer) {
  const items = [...(dt.items || [])].map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  const list: Array<{ file: File; path: string }> = [];
  if (items.some(Boolean)) {
    for (const e of items) if (e) await readEntry(e, '', list);
  } else [...dt.files].forEach(f => list.push({ file: f, path: f.name }));
  add(list);
}
function fromInput(inp: HTMLInputElement) {
  add([...(inp.files || [])].map(f => ({ file: f, path: (f as any).webkitRelativePath || f.name })));
  inp.value = '';
}

// ------------------------------------------------------------------------------------- converting

async function uniqueName(base: string, taken: (n: string) => Promise<boolean>) {
  let name = base + '.SVGcinema',
    n = 2;
  while (await taken(name)) name = `${base} (${n++}).SVGcinema`;
  return name;
}
async function inFolder(name: string) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (_) {
    return false;
  }
}
async function writeFolder(name: string, blob: Blob) {
  const h = await dir.getFileHandle(name, { create: true }),
    w = await h.createWritable();
  await w.write(blob);
  await w.close();
}
async function ensureFolder() {
  if (out !== 'folder') return true;
  if (!dir) await pickFolder();
  if (!dir) return false;
  if (dir.queryPermission && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted')
    if (!dir.requestPermission || (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
  return true;
}
async function convertOne(row: Row, title: boolean) {
  row.status = 'run';
  render();
  const text = await row.file.text(),
    r = await api.convert(row.file.name, text, title);
  row.r = r;
  if (!r.ok) {
    row.status = 'fail';
    row.why = r.error;
    return;
  }
  if (out === 'folder') {
    let name = r.base + '.SVGcinema';
    if (await inFolder(name)) {
      if (exists === 'skip') {
        row.status = 'skip';
        row.out = name;
        return;
      }
      if (exists === 'both') name = await uniqueName(r.base, inFolder);
    }
    try {
      await writeFolder(name, r.project);
    } catch (e) {
      row.status = 'fail';
      row.why = 'It couldn’t be written to the folder' + (e && e.message ? ` (${e.message}).` : '.');
      return;
    }
    row.out = name;
  } else {
    const used = new Set(rows.filter(x => x !== row && x.out).map(x => x.out));
    row.out = await uniqueName(r.base, async n => used.has(n));
  }
  row.status = r.notes && r.notes.length ? 'notes' : 'done';
}
async function run() {
  if (running) return;
  if (!(await ensureFolder())) return;
  running = true;
  paused = false;
  render();
  await ready;
  const title = $<HTMLInputElement>('#titleNames').checked;
  for (;;) {
    if (paused) break;
    const row = rows.find(x => x.status === 'wait');
    if (!row) break;
    await convertOne(row, title);
    render();
  }
  running = false;
  if (!paused && out === 'zip') await makeZip(true);
  render();
}
async function makeZip(download: boolean) {
  const done = rows.filter(r => (r.status === 'done' || r.status === 'notes') && r.r && r.r.project);
  if (!done.length) return;
  zipBlob = await api.zipAll(done.map(r => ({ name: r.out, blob: r.r.project })));
  if (download) saveBlob(zipBlob, `SVGcinema projects (${done.length}).zip`);
}
function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ------------------------------------------------------------------------------------- the list

const ICONS = {
  ok: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>',
  warn: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3l8 14H2z"/><path d="M10 8.5v3.5M10 14.6v.1"/></svg>',
  bad: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  run: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 2a6 6 0 1 1-6 6"/></svg>',
  skip: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l5 4-5 4zM11 4v8"/></svg>',
};
const fmtS = (s: number) => (Math.round(s * 100) / 100).toString().replace(/\.0+$/, '') + ' s';
function info(r: BatchResult) {
  const p = [
    `${r.layers} layer${r.layers === 1 ? '' : 's'}`,
    `${r.animated} animated`,
    `${fmtS(r.dur)}, ${r.it ? (r.it === 1 ? 'plays once' : `plays ${r.it} times`) : 'loops'}`,
  ];
  if (r.images) p.push(`${r.images} image${r.images === 1 ? '' : 's'}`);
  return p.join(' · ');
}
function rowHTML(x: Row) {
  const r = x.r,
    target = x.out || (r && r.base ? r.base + '.SVGcinema' : x.file.name.replace(/\.svg$/i, '') + '.SVGcinema');
  let thumb = '<div class="cv-thumb empty"></div>',
    what = '—',
    status = '<span class="cv-st wait">Waiting</span>',
    acts = `<button class="quiet" data-act="remove" data-id="${x.id}">Remove</button>`,
    cls = '';
  if (r && r.thumb) thumb = `<img class="cv-thumb" src="${r.thumb}" alt="">`;
  if (r && r.ok) what = esc(info(r));
  if (x.status === 'run') {
    cls = 'run';
    thumb = '<div class="cv-thumb run"></div>';
    what = 'Reading the animation…';
    status = `<span class="cv-st run">${ICONS.run}Converting</span>`;
    acts = '';
  } else if (x.status === 'done' || x.status === 'notes') {
    cls = x.status === 'notes' ? 'notes' : '';
    status =
      x.status === 'notes'
        ? `<span class="cv-st warn">${ICONS.warn}${out === 'folder' ? 'Saved' : 'Ready'}, with notes</span><div class="cv-why">${
            r.notes.length === 1 ? esc(r.notes[0]) : `<ul>${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`
          }</div>`
        : `<span class="cv-st ok">${ICONS.ok}${out === 'folder' ? 'Saved' : 'Ready'}</span>`;
    acts = `<button data-act="open" data-id="${x.id}">Open in editor</button>`;
  } else if (x.status === 'skip') {
    status = `<span class="cv-st wait">${ICONS.skip}Skipped</span><div class="cv-why">Already in the folder.</div>`;
    acts = `<button data-act="open" data-id="${x.id}">Open in editor</button>`;
  } else if (x.status === 'fail') {
    cls = 'fail';
    thumb = '<div class="cv-thumb fail">No picture</div>';
    status = `<span class="cv-st bad">${ICONS.bad}Failed</span><div class="cv-why">${esc(x.why)}</div>`;
    acts = `<button data-act="retry" data-id="${x.id}">Try again</button>`;
  }
  const to = x.status === 'fail' ? 'nothing saved' : esc(target);
  return `<div class="cv-tr ${cls}" role="row" data-row="${x.id}">${thumb}<div class="cv-name"><b>${esc(x.path)}</b><span>→ ${to}</span></div><div class="cv-info">${what}</div><div class="cv-status">${status}</div><div class="cv-acts">${acts}</div></div>`;
}
function render() {
  const any = rows.length > 0;
  $('#start').hidden = any;
  $('#work').hidden = !any;
  if (!any) return;
  const n = (s: Status) => rows.filter(r => r.status === s).length,
    done = n('done') + n('notes') + n('skip') + n('fail'),
    total = rows.length,
    cur = rows.findIndex(r => r.status === 'run');
  const counts = [
    running
      ? `<b>Converting ${cur + 1 > 0 ? cur + 1 : done} of ${total}</b>`
      : done === total
        ? `<b>Finished: ${total} file${total === 1 ? '' : 's'}</b>`
        : `<b>${total} file${total === 1 ? '' : 's'}</b>`,
    n('done') + n('notes') ? `<span class="ok">${n('done') + n('notes')} done</span>` : '',
    n('notes') ? `<span class="warn">${n('notes')} with notes</span>` : '',
    n('skip') ? `<span class="muted">${n('skip')} skipped</span>` : '',
    n('fail') ? `<span class="bad">${n('fail')} failed</span>` : '',
    n('wait') ? `<span class="muted">${n('wait')} waiting</span>` : '',
  ];
  $('#counts').innerHTML = counts.filter(Boolean).join('');
  $('#bar').style.width = (total ? (done / total) * 100 : 0) + '%';
  $('#rows').innerHTML =
    rows.slice(0, SHOW).map(rowHTML).join('') +
    (rows.length > SHOW ? `<div class="cv-more">+ ${rows.length - SHOW} more</div>` : '');
  // settings
  document.querySelectorAll<HTMLInputElement>('input[name=out]').forEach(i => {
    i.checked = i.value === out;
    i.disabled = running;
  });
  $('#optFolder').hidden = !canFolder;
  $('#folderBox').hidden = out !== 'folder';
  $('#folderName').textContent = dir ? dir.name : 'No folder chosen';
  $('#existsGroup').hidden = out !== 'folder';
  document.querySelectorAll<HTMLButtonElement>('[data-exists]').forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.exists === exists));
    b.disabled = running;
  });
  $<HTMLInputElement>('#titleNames').disabled = running;
  $('#where').innerHTML =
    out === 'folder'
      ? dir
        ? `Saving into <b>${esc(dir.name)}</b> · ${{ skip: 'existing projects are skipped', replace: 'existing projects are replaced', both: 'existing projects are kept, new ones numbered' }[exists]}`
        : 'Choose the folder to save into'
      : 'All projects download as one .zip at the end';
  const waiting = n('wait');
  const go = $<HTMLButtonElement>('#go');
  go.textContent = waiting ? `Convert ${waiting} file${waiting === 1 ? '' : 's'}` : 'Convert';
  go.disabled = running || !waiting;
  $('#pause').hidden = !running;
  $('#pause').textContent = paused ? 'Pausing…' : 'Pause';
  $<HTMLButtonElement>('#clear').disabled = running;
  $<HTMLButtonElement>('#report').disabled = !done;
  $('#zipAgain').hidden = !(out === 'zip' && zipBlob && !running);
}

// ------------------------------------------------------------------------------------- actions

async function pickFolder() {
  try {
    dir = await (window as any).showDirectoryPicker({ id: 'svgcinema-convert', mode: 'readwrite' });
  } catch (_) {}
  render();
}
function openInEditor(row: Row) {
  const blob = row.r && row.r.project;
  if (!blob) return;
  // a new tab with the editor this tool carries, handed the project to open
  if (!EDITOR) return; // (development: the dev server has no editor to hand over to)
  const w = window.open('', '_blank') as any;
  if (!w) return;
  w.document.open();
  w.document.write(editorWith('__CIN_RECEIVE__'));
  w.document.close();
  w.__cinOpenFile = { name: row.out || row.r.base + '.SVGcinema', blob };
}
function csv() {
  const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`,
    label: Record<Status, string> = {
      wait: 'waiting',
      run: 'converting',
      done: 'saved',
      notes: 'saved with notes',
      fail: 'failed',
      skip: 'skipped (already in the folder)',
    };
  const lines = [
    ['File', 'Project', 'Result', 'Layers', 'Animated', 'Length (s)', 'Repeat', 'Images', 'Notes'].map(q).join(','),
  ];
  rows.forEach(x => {
    const r = x.r || ({} as BatchResult);
    lines.push(
      [
        x.path,
        x.status === 'fail' ? '' : x.out || '',
        label[x.status],
        r.layers ?? '',
        r.animated ?? '',
        r.dur ?? '',
        r.ok ? (r.it ? r.it + ' times' : 'loops') : '',
        r.images ?? '',
        x.status === 'fail' ? x.why : (r.notes || []).join(' | '),
      ]
        .map(q)
        .join(','),
    );
  });
  saveBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }), 'SVGcinema conversion report.csv');
}

function init() {
  loadEditor();
  document.addEventListener('click', e => {
    const t = e.target as HTMLElement,
      pick = t.closest<HTMLElement>('[data-pick]');
    if (pick) (pick.dataset.pick === 'folder' ? $('#pickFolder') : $('#pickFiles')).click();
    const act = t.closest<HTMLElement>('[data-act]');
    if (act) {
      const row = rows.find(r => r.id === +act.dataset.id);
      if (!row) return;
      if (act.dataset.act === 'remove') rows = rows.filter(r => r !== row);
      if (act.dataset.act === 'retry') {
        row.status = 'wait';
        row.r = undefined;
        row.why = '';
      }
      if (act.dataset.act === 'open') return openInEditor(row);
      render();
      if (act.dataset.act === 'retry' && !running) run();
    }
    const ex = t.closest<HTMLElement>('[data-exists]');
    if (ex && !running) {
      exists = ex.dataset.exists as Exists;
      render();
    }
  });
  $('#pickFiles').addEventListener('change', e => fromInput(e.target as HTMLInputElement));
  $('#pickFolder').addEventListener('change', e => fromInput(e.target as HTMLInputElement));
  document.querySelectorAll<HTMLInputElement>('input[name=out]').forEach(i =>
    i.addEventListener('change', () => {
      out = i.value as 'folder' | 'zip';
      zipBlob = null;
      render();
    }),
  );
  $('#folderPick').addEventListener('click', pickFolder);
  $('#go').addEventListener('click', run);
  $('#pause').addEventListener('click', () => {
    paused = true;
    render();
  });
  $('#clear').addEventListener('click', () => {
    rows = [];
    zipBlob = null;
    render();
  });
  $('#report').addEventListener('click', csv);
  $('#zipAgain').addEventListener('click', () => zipBlob && saveBlob(zipBlob, 'SVGcinema projects.zip'));
  // dropping anywhere on the page adds the files; the drop zones light up
  let depth = 0;
  const zones = () => document.querySelectorAll('[data-drop]');
  window.addEventListener('dragenter', e => {
    e.preventDefault();
    depth++;
    zones().forEach(z => z.classList.add('over'));
  });
  window.addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      zones().forEach(z => z.classList.remove('over'));
    }
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    depth = 0;
    zones().forEach(z => z.classList.remove('over'));
    if (e.dataTransfer) fromDrop(e.dataTransfer);
  });
  render();
}
init();

/** for tests: the converter's state */
(window as any).cinConvert = {
  rows: () => rows,
  add,
  run,
  setOut: (o: 'folder' | 'zip') => ((out = o), render()),
  ready: () => ready,
};
