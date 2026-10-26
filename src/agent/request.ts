// SVGcinema — agent/request
// One request to the design agent is one undo step, however many tools it runs. Editor functions the
// tools call (applyPreset, groupSel, deleteSel, placeAsset, the SVG importer…) each push their own
// undo entry; when the request ends those are taken out again and the document as it was before the
// request is pushed once, so Undo (or "Undo this request") rolls the whole request back.
import { S, doc } from '../core/state';
import { commit } from '../core/history';

export interface AgentRequest {
  /** the document before the request */
  snap: string;
  /** the undo entry that was on top when it started (undefined: the stack was empty) */
  mark: string | undefined;
  /** how many entries the stack held then */
  depth: number;
  open: boolean;
}

export function beginRequest(): AgentRequest {
  return { snap: JSON.stringify(doc), mark: S.undo[S.undo.length - 1], depth: S.undo.length, open: true };
}

/** Close the request: one undo step if anything changed, none if nothing did. Returns whether the
 *  document changed. Safe to call twice. */
export function endRequest(r: AgentRequest): boolean {
  if (!r.open) return false;
  r.open = false;
  // drop what the tools pushed. The stack is capped (old entries fall off the front), so find where
  // the request started by its top entry rather than by its length.
  // (entries only ever move down when the oldest fall off, so it sits at or before its old position)
  // (not found at all: the request pushed so many that every older entry fell off)
  const keep = r.mark === undefined ? 0 : S.undo.lastIndexOf(r.mark, r.depth - 1) + 1;
  S.undo.length = Math.min(keep, S.undo.length);
  const changed = JSON.stringify(doc) !== r.snap;
  if (changed) {
    S.undo.push(r.snap);
    if (S.undo.length > 150) S.undo.shift();
    S.redo = [];
  }
  commit({ insp: true });
  return changed;
}

/** Whether "Undo this request" still applies: nothing else was edited since it ended. */
export function isLatest(r: AgentRequest) {
  return !r.open && S.undo[S.undo.length - 1] === r.snap;
}
