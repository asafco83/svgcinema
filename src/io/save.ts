// SVGcinema — io/save
import { track } from '../core/analytics';
import { $ } from '../core/constants';
import { ASSETS, S, doc } from '../core/state';
import { fileName } from '../export/images';
import { markClean, persistFile } from './file-state';
import { addRecent } from './recent';
import { toast } from './open';
import { buildProject, usedAssetIds } from './zip';
import { CHAT_EXTRA, extraFiles } from './extras';
import { kb } from '../ui/inspector';

export const PROJECT_TYPES = [
  { description: 'SVGcinema project', accept: { 'application/x-svgcinema-project': ['.SVGcinema'] } },
];
export function canPick() {
  return typeof (window as any).showSaveFilePicker === 'function';
}
export async function writeHandle(handle: any, blob: Blob) {
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if (!handle.requestPermission || (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted')
      throw Object.assign(new Error('permission'), { name: 'NotAllowedError' });
  }
  const w = await handle.createWritable();
  await w.write(blob);
  await w.close();
}
export async function downloadProject(name: string, blob: Blob) {
  if ((window as any).claude && (window as any).claude.use) {
    let dl = null;
    try {
      dl = await (window as any).claude.use('downloads');
    } catch (e) {}
    if (dl) {
      try {
        await dl.save({ filename: name + '.SVGcinema', data: blob });
        return name + '.SVGcinema';
      } catch (err) {
        if (err && err.code === 'declined') return null;
        if (err && (err.code === 'rejected_extension' || err.code === 'extension_not_enabled')) {
          try {
            await dl.save({ filename: name + '.SVGcinema.zip', data: blob });
            toast(
              'This viewer can only download .zip files, so it was saved as ' +
                name +
                '.SVGcinema.zip. SVGcinema opens it as it is.',
            );
            return name + '.SVGcinema.zip';
          } catch (e2) {
            if (e2 && e2.code === 'declined') return null;
          }
        }
        toast('Saving files is not available here.');
        return null;
      }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.SVGcinema';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return name + '.SVGcinema';
}
export async function saveProject() {
  if (!S.file || !S.file.name) return saveProjectAs();
  const blob = await buildProject(S.saveAll !== false, chatSkip());
  if (S.file.handle) {
    try {
      await writeHandle(S.file.handle, blob);
      markClean();
      track('project_saved', { method: 'file' });
      addRecent(S.file.name, S.file.handle as any, null);
      toast('Saved ' + S.file.name);
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      toast('Couldn’t write to ' + S.file.name + '. Choose where to save it.');
      return saveProjectAs();
    }
  }
  const name = S.file.name.replace(/\.svgcinema(\.zip)?$/i, '');
  const got = await downloadProject(name, blob);
  if (got) {
    S.file = { name: got, handle: null };
    persistFile();
    markClean();
    track('project_saved', { method: 'download' });
    addRecent(got, null, blob);
    toast('Downloaded ' + got + '. Browsers can’t overwrite downloads, so this is a fresh copy.');
    return true;
  }
  return false;
}
/** the extra files Save leaves out: the agent's chat unless the user keeps "Include AI agent chats" on */
const chatSkip = () => (S.saveChat === false ? [CHAT_EXTRA] : []);
export let saveResolve: ((v: boolean) => void) | null = null;
export function saveProjectAs(): Promise<boolean> {
  return new Promise<boolean>(res => {
    saveResolve = res;
    const all = Object.keys(ASSETS).length,
      used = usedAssetIds(),
      unused = Object.keys(ASSETS).filter(id => !used.has(id)),
      size = (ids: string[]) => ids.reduce((s, id) => s + (ASSETS[id].size || 0), 0);
    $('#sName').value = S.file && S.file.name ? S.file.name.replace(/\.svgcinema(\.zip)?$/i, '') : fileName(doc.name);
    $('#sAll').checked = S.saveAll !== false;
    $('#sAll').closest('label').hidden = !unused.length;
    // only offered when there is a chat to include
    $('#sChat').checked = S.saveChat !== false;
    $('#sChat').closest('label').hidden = !extraFiles().some(f => f.name === CHAT_EXTRA);
    $('#sStats').innerHTML =
      `<span>Layers <b>${doc.layers.length}</b></span><span>Assets <b>${all}</b>${all ? ` · ${kb(size(Object.keys(ASSETS)))}` : ''}</span>${unused.length ? `<span>Unused <b>${unused.length}</b></span>` : ''}`;
    $('#sNote').innerHTML =
      'A .SVGcinema file holds the whole project: layers, keyframes, easing presets, export settings and every image, so it opens exactly as you left it. ' +
      (canPick()
        ? 'Next you’ll choose where to save it. After that, Save overwrites the same file.'
        : 'It goes to your downloads folder.');
    $('#mSave').hidden = false;
    setTimeout(() => {
      $('#sName').focus();
      $('#sName').select();
    }, 0);
  });
}
export function endSave(v: boolean) {
  $('#mSave').hidden = true;
  const r = saveResolve;
  saveResolve = null;
  if (r) r(v);
}

export function init(): void {
  $('#mSave').addEventListener(
    'click',
    (e: MouseEvent) => {
      if ((e.target as any).id === 'mSave' || (e.target as any).closest('[data-close]')) endSave(false);
    },
    true,
  );
  $('#sName').addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') $('#sGo').click();
  });
  $('#sGo').addEventListener('click', async () => {
    const name = fileName(($('#sName').value.trim() || doc.name).replace(/\.svgcinema(\.zip)?$/i, ''));
    S.saveAll = $('#sAll').checked;
    if (!($('#sChat').closest('label') as HTMLElement).hidden) S.saveChat = $('#sChat').checked;
    const blob = await buildProject(S.saveAll, chatSkip());
    if (canPick()) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: name + '.SVGcinema',
          types: PROJECT_TYPES,
          id: 'svgcinema',
        });
        await writeHandle(handle, blob);
        S.file = { name: handle.name, handle };
        persistFile();
        markClean();
        track('project_saved', { method: 'file' });
        addRecent(handle.name, handle, null);
        toast('Saved ' + handle.name);
        endSave(true);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; /* sandboxed or blocked: fall back to download */
      }
    }
    const got = await downloadProject(name, blob);
    if (got) {
      S.file = { name: got, handle: null };
      persistFile();
      markClean();
      track('project_saved', { method: 'download' });
      addRecent(got, null, blob);
      toast('Saved ' + got + ' to your downloads.');
      endSave(true);
    } else endSave(false);
  });
  $('#bSave').addEventListener('click', () => saveProject());
  $('#bSaveAs').addEventListener('click', () => saveProjectAs());
}
