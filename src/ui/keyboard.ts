// SVGcinema — ui/keyboard
import { zoomShortcut } from './zoom-menu';
import { animateShortcut } from './animate-menu';
import { viewShortcut } from './view-menu';
import { agentShortcut } from './agent-panel';
import { BUSY } from '../agent/busy';
import {
  arrangeEnd,
  clearLayerClip,
  closeLayerMenu,
  copyLayers,
  exportSelection,
  hasLayerClip,
  layerShortcut,
  pasteLayers,
  selectAllLayers,
  toggleHide,
} from './layer-menu';
import { keyName } from '../core/keys';
import { openShortcuts } from './shortcuts';
import { pickPaint } from './props-panel';
import { toggleAllSections } from './inspector';
import { pickTool } from './tools-rail';
import { setSpace } from '../tools/hand';
import { $, H, TOOL_INFO, clone, r2 } from '../core/constants';
import { beginEdit, deleteKeys, redo, select, selectMany, setProp, setTime, setTool, undo } from '../core/history';
import { closeMenu, copyKeys, duplicateKeys, jumpKey, pasteKeys, selectAllKeys, shiftKeys } from '../core/keyframes';
import { togglePlay } from '../core/playback';
import { S, doc, selLayer } from '../core/state';
import { openExport } from '../export/build';
import { removeNodeAll } from '../geometry/nodes';
import { openFlow, toast } from '../io/open';
import { saveProject, saveProjectAs } from '../io/save';
import { isLocked } from '../model/tree';
import { finishPen, penBackspace } from '../tools/pen';
import { selectedPosKeys } from '../tools/stage-input';
import { applyEase } from './easing';
import { cancelBind } from '../tools/bone-edit';
import { deleteSelectedPin, endPinBind } from '../tools/pins';
import { FM, closeFileMenu } from './file-menu';
import { renderInspector } from './inspector';
import { arrange, deleteSel, duplicate, groupSel, ungroup } from './layers-panel';
import { FRAME, MENU, renderTimeline } from './timeline';
import { closeModal } from './topbar';

export function init(): void {
  // which area arrow keys act on: the timeline (move keyframes in time) or the canvas (nudge)
  window.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      const t = e.target as Element;
      if (t.closest('#wrap')) S.kbArea = 'stage';
      else if (t.closest('.tl-scroll, .tl-ctrl')) S.kbArea = 'timeline';
    },
    true,
  );
  window.addEventListener('keyup', (e: KeyboardEvent) => {
    if (e.key !== ' ' || !S.spaceHeld) return;
    setSpace(false);
    const tg: any = e.target;
    if (!S.spaceUsed && !(tg.closest && tg.closest('input,textarea,select'))) togglePlay();
    S.spaceUsed = false;
  });
  window.addEventListener('blur', () => S.spaceHeld && setSpace(false));
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const tg: any = e.target,
      typing = tg.closest && tg.closest('input,textarea,select');
    if (e.key === 'Escape') {
      if (!$('#layermenu').hidden) {
        closeLayerMenu();
        return;
      }
      if (!MENU.hidden) {
        closeMenu();
        return;
      }
      const m = [...(document.querySelectorAll as any)('.modal')].find(x => !x.hidden);
      if (m) {
        closeModal(m);
        return;
      }
    }
    const modk = e.ctrlKey || e.metaKey,
      // letter shortcuts by the physical key, so they work on any keyboard layout
      kk = keyName(e).toLowerCase();
    if (modk && kk === 's') {
      e.preventDefault();
      if (!$('#mSave').hidden) return;
      e.shiftKey ? saveProjectAs() : saveProject();
      return;
    }
    if (modk && kk === 'o') {
      e.preventDefault();
      openFlow();
      return;
    }
    if (modk && kk === 'e' && !typing) {
      e.preventDefault();
      if (e.shiftKey && selLayer()) return void exportSelection();
      openExport();
      return;
    }
    if (modk && kk === 'i' && !typing) {
      e.preventDefault();
      $('#bImport').click();
      return;
    }
    if (e.key === 'Escape' && !FM.hidden) {
      closeFileMenu();
      return;
    }
    if (e.key === 'F1') {
      e.preventDefault();
      openShortcuts();
      return;
    }
    if (typing) return;
    if ([...(document.querySelectorAll as any)('.modal')].some(x => !x.hidden)) return;
    if (agentShortcut(e)) {
      e.preventDefault();
      return;
    }
    // while the agent works, editing waits (its request stays one undo step): play and zoom still work
    if (BUSY.on) {
      if (zoomShortcut(e)) e.preventDefault();
      else if (e.code !== 'Space' && e.key !== 'Home') return;
    }
    if (zoomShortcut(e)) {
      e.preventDefault();
      return;
    }
    const mod = e.ctrlKey || e.metaKey,
      l = selLayer(),
      k = keyName(e);
    if (mod && k.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (mod && k.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (viewShortcut(e)) {
      e.preventDefault();
      return;
    }
    // Ctrl+X: cut the selected keyframes (layers: below)
    if (mod && !e.shiftKey && k.toLowerCase() === 'x' && S.keys.size) {
      e.preventDefault();
      clearLayerClip();
      copyKeys();
      deleteKeys();
      return;
    }
    // Ctrl+H: hide / show the selection
    if (mod && !e.shiftKey && k.toLowerCase() === 'h') {
      e.preventDefault();
      toggleHide();
      return;
    }
    // Ctrl+↑ / Ctrl+↓: bring forward / send backward (Shift: to the front / back)
    if (mod && (k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault();
      if (l) e.shiftKey ? arrangeEnd(l, k === 'ArrowUp') : arrange(l, k === 'ArrowUp' ? 1 : -1);
      return;
    }
    if (layerShortcut(e)) {
      e.preventDefault();
      return;
    }
    // one clipboard: keyframes when keyframes are selected, otherwise layers
    if (mod && k.toLowerCase() === 'c') {
      if (S.keys.size) {
        e.preventDefault();
        clearLayerClip();
        copyKeys();
      } else if (selLayer()) {
        e.preventDefault();
        S.clip = null;
        copyLayers();
      }
      return;
    }
    if (mod && k.toLowerCase() === 'v') {
      if (S.clip && S.clip.length) {
        e.preventDefault();
        pasteKeys();
      } else if (hasLayerClip()) {
        e.preventDefault();
        pasteLayers();
      }
      return;
    }
    // Ctrl+A: every layer (every keyframe while working in the timeline); Ctrl+Shift+A: nothing
    if (mod && k.toLowerCase() === 'a') {
      e.preventDefault();
      if (e.shiftKey) selectMany([]);
      else if (S.kbArea === 'timeline') selectAllKeys();
      else selectAllLayers();
      return;
    }
    if (k === 'F9') {
      e.preventDefault();
      if (S.keys.size) applyEase(mod && e.shiftKey ? 'out' : e.shiftKey ? 'in' : 'inOut');
      return;
    }
    if (mod && k.toLowerCase() === 'd') {
      e.preventDefault();
      if (S.keys.size) duplicateKeys();
      else if (l) duplicate(l);
      return;
    }
    if (mod && k.toLowerCase() === 'g') {
      e.preventDefault();
      if (e.shiftKey) ungroup(l);
      else groupSel();
      return;
    }
    if (mod && (k === ']' || k === '[')) {
      e.preventDefault();
      if (l) arrange(l, k === ']' ? 1 : -1);
      return;
    }
    if (mod) return;
    if (k === ' ' && e.shiftKey) {
      // Shift+Space: stop and go back to the start
      e.preventDefault();
      if (S.playing) togglePlay();
      setTime(0);
      return;
    }
    if (k === ' ') {
      // hold Space for the hand tool; a tap (no drag) plays/pauses on release
      e.preventDefault();
      if (!e.repeat) {
        S.spaceUsed = !!S.drag;
        setSpace(true);
      }
      return;
    }
    if (k === 'Enter' && S.pen) {
      finishPen(false);
      return;
    }
    if (k === 'Escape') {
      if (S.pen) {
        finishPen(false);
        return;
      }
      if (cancelBind()) return;
      if (endPinBind()) return;
      if (S.tool !== 'select') {
        setTool('select');
        return;
      }
      if (S.keys.size) {
        S.keys.clear();
        renderTimeline();
        renderInspector();
        return;
      }
      select(null);
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && S.pen) {
      e.preventDefault();
      penBackspace();
      return;
    }
    if (S.drag && S.drag.key && S.drag.key(k, e)) {
      e.preventDefault();
      return;
    }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      if (S.keys.size) return deleteKeys();
      if (deleteSelectedPin()) return;
      if (S.tool === 'node' && S.node && l) {
        const ed = beginEdit();
        if (!removeNodeAll(l, S.node[0], S.node[1])) toast('A path needs at least two nodes.');
        S.node = null;
        ed.end({ insp: true });
        return;
      }
      deleteSel();
      return;
    }
    if (k === 'Home') {
      setTime(0);
      return;
    }
    if (k === 'End') {
      setTime(doc.dur);
      return;
    }
    if (k.toLowerCase() === 'j' || k.toLowerCase() === 'k') {
      jumpKey(k.toLowerCase() === 'k' ? 1 : -1);
      return;
    }
    // ←/→ shift selected keyframes in time while working in the timeline; on the canvas arrows nudge
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && S.keys.size && S.kbArea === 'timeline') {
      e.preventDefault();
      shiftKeys((k === 'ArrowRight' ? 1 : -1) * FRAME * (e.shiftKey ? 10 : 1));
      return;
    }
    if (k === ',' || k === '.') {
      setTime(S.time + (k === '.' ? 1 : -1) / 30);
      return;
    }
    if (k.startsWith('Arrow') && l && !isLocked(l)) {
      e.preventDefault();
      const st = e.shiftKey ? 10 : 1,
        p = clone(H.get(l, 'pos', S.time)),
        d = [k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0],
        keys = selectedPosKeys(l);
      const ed = beginEdit();
      if (keys.length) keys.forEach(q => (q[1] = [r2(q[1][0] + d[0]), r2(q[1][1] + d[1])]));
      else setProp(l, 'pos', [r2(p[0] + d[0]), r2(p[1] + d[1])]);
      ed.end();
      return;
    }
    if (animateShortcut(e)) {
      e.preventDefault();
      return;
    }
    // I / Alt+I: pick the fill / stroke colour from the screen
    if (k.toLowerCase() === 'i' && !e.shiftKey && l && !isLocked(l)) {
      if (pickPaint(l, e.altKey ? 'stk' : 'fill')) e.preventDefault();
      return;
    }
    // "/": close (or open) every inspector section
    if (k === '/' && !e.shiftKey && !e.altKey) {
      if (toggleAllSections()) e.preventDefault();
      return;
    }
    const lk = k.toLowerCase(),
      combo = e.shiftKey && /^[a-z]$/.test(lk) ? 'shift+' + lk : lk,
      id = Object.keys(TOOL_INFO).find(t => (TOOL_INFO[t].keys || []).includes(combo));
    if (id && !e.altKey) pickTool(id);
  });
}
