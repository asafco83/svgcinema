// SVGcinema — ui/topbar
import { applyPan } from '../tools/hand';
import { $, clamp } from '../core/constants';
import { TLS, WRAP } from '../core/dom';
import { save } from '../core/history';
import { ASSETS, S, blankDoc, doc, setIdc, syncIdc } from '../core/state';
import { openExport } from '../export/build';
import { closeKind } from '../export/kind';
import { importFiles, placeAsset } from '../io/assets';
import { confirmDiscard } from '../io/guard';
import { applyProject, toast } from '../io/open';
import { importSVG } from '../io/svg-import';
import { sampleDoc } from '../model/sample';
import { docPt } from '../render/overlay';
import { renderAll } from '../render/stage';
import { tln } from './timeline';

export function closeModal(m: HTMLElement) {
  m.hidden = true;
  if (m.id === 'mExport') {
    closeKind();
    S.exportOnly = null;
    const s = $('#xprev svg');
    if (s && s.player) s.player.destruct();
    $('#xprev').innerHTML = '';
  }
}
export const drop = $('#iDrop');
export function pushHistory() {
  S.undo.push(JSON.stringify(doc));
  S.redo = [];
}
export function fitTimeline() {
  const w = TLS.clientWidth - tln() - 60;
  if (w > 100) {
    S.pps = Math.round(clamp(w / doc.dur, 40, 420));
    $('#tZoom').value = S.pps;
  }
}
export function resetView() {
  fitTimeline();
  S.sel = null;
  S.selSet.clear();
  S.keys.clear();
  S.time = 0;
  S.ptime = 0;
  S.exp = {};
  S.zoom = 1;
  S.pan = { x: 0, y: 0 };
  syncIdc();
  save();
  renderAll();
  applyPan();
}

export function init(): void {
  document.querySelectorAll<HTMLElement>('.modal').forEach(m => {
    m.addEventListener('click', (e: MouseEvent) => {
      if (e.target === m || (e.target as any).closest('[data-close]')) closeModal(m);
    });
  });
  $('#bExport').addEventListener('click', openExport);
  $('#bImport').addEventListener('click', () => {
    $('#iText').value = '';
    $('#iReplace').checked = false;
    $('#mImport').hidden = false;
  });
  $('#iPick').addEventListener('click', () => {
    S.pickPlace = true;
    $('#fSvg').click();
  });
  $('#fSvg').addEventListener('change', async (e: Event) => {
    const fs = [...(e.target as any).files];
    (e.target as any).value = '';
    if (!fs.length) return;
    const place = S.pickPlace !== false;
    if (place) {
      $('#mImport').hidden = true;
      if ($('#iReplace').checked && fs.length === 1 && /\.svg$/i.test(fs[0].name)) {
        const t = await fs[0].text();
        importSVG(t, true, fs[0].name.replace(/\.svg$/i, ''));
        return;
      }
    }
    importFiles(fs, null, place);
  });
  $('#iGo').addEventListener('click', async () => {
    const t = $('#iText').value.trim();
    if (!t) {
      toast('Paste SVG markup or choose files first.');
      return;
    }
    if (await importSVG(t, $('#iReplace').checked)) $('#mImport').hidden = true;
  });
  ['dragover', 'dragenter'].forEach(ev =>
    drop.addEventListener(ev, (e: DragEvent) => {
      e.preventDefault();
      drop.classList.add('over');
    }),
  );
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    const fs = [...e.dataTransfer.files];
    if (!fs.length) return;
    $('#mImport').hidden = true;
    importFiles(fs, null, true);
  });
  WRAP.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
  });
  WRAP.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    const p = docPt(e);
    let aid = '';
    try {
      aid = e.dataTransfer.getData('text/x-svgcinema-asset');
    } catch (_) {}
    if (aid && ASSETS[aid]) {
      placeAsset(ASSETS[aid], p);
      return;
    }
    const fs = [...e.dataTransfer.files];
    if (fs.length) importFiles(fs, p, true);
  });
  document.addEventListener('paste', (e: ClipboardEvent) => {
    if ((e.target as any).closest && (e.target as any).closest('input,textarea')) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const fs = [...(cd.files || [])].filter(f => /^image\//.test(f.type));
    if (fs.length) {
      e.preventDefault();
      importFiles(
        fs.map((f, i) =>
          f.name ? f : new File([f], 'pasted-' + (i + 1) + '.' + (f.type.split('/')[1] || 'png'), { type: f.type }),
        ),
        null,
        true,
      );
      return;
    }
    const t = cd.getData('text');
    if (t && /<svg[\s>]/i.test(t)) {
      e.preventDefault();
      importSVG(t, false);
    }
  });
  $('#bNew').addEventListener('click', async () => {
    if (await confirmDiscard('Starting a new project closes this one. Save your changes first?'))
      $('#mNew').hidden = false;
  });
  $('#nBlank').addEventListener('click', () => {
    const w = parseInt($('#nW').value) || 640,
      hh = parseInt($('#nH').value) || 400;
    setIdc(0);
    applyProject(blankDoc(clamp(w, 16, 8000), clamp(hh, 16, 8000)), {}, null);
    $('#mNew').hidden = true;
  });
  $('#nSample').addEventListener('click', () => openSample(true));
}
/** Help › Open the sample scene: the editor's tour of every feature (asks to save changes first). */
export async function openSample(asked = false) {
  if (!asked && !(await confirmDiscard('Opening the sample scene closes this project. Save your changes first?')))
    return;
  applyProject(sampleDoc(), {}, null);
  $('#mNew').hidden = true;
}
