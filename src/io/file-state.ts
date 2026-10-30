// SVGcinema — io/file-state
import { $, esc } from '../core/constants';
import { S } from '../core/state';
import { IDB } from './assets';
import { EPHEMERAL } from '../core/batch-mode';

export function markDirty() {
  if (S.loading) return;
  if (!S.dirty) {
    S.dirty = true;
    try {
      if (!EPHEMERAL) localStorage.setItem('svgcinema:dirty', '1');
    } catch (e) {}
  }
  updateFileInfo();
}
export function markClean() {
  S.dirty = false;
  try {
    if (!EPHEMERAL) localStorage.setItem('svgcinema:dirty', '0');
  } catch (e) {}
  updateFileInfo();
}
export function updateFileInfo() {
  const el = $('#fileInfo');
  if (!el) return;
  const f = S.file;
  el.innerHTML =
    (S.dirty ? '<i class="dirty" aria-hidden="true"></i>' : '') +
    esc(f && f.name ? f.name : 'Not saved yet') +
    (S.dirty ? ' · unsaved changes' : '');
  el.title =
    f && f.handle
      ? 'Save overwrites this file'
      : f && f.name
        ? 'Save downloads a new copy of this file'
        : 'Use Save to keep this project as a .SVGcinema file';
}
export function persistFile() {
  IDB.set('file', S.file ? { name: S.file.name, handle: S.file.handle || null } : null).then(ok => {
    if (!ok && S.file && S.file.handle) IDB.set('file', { name: S.file.name, handle: null });
  });
}
