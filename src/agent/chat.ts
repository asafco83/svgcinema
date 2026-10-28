// SVGcinema — agent/chat
// The design agent's conversation for the open project. It travels with the project: saved inside
// the .SVGcinema file as agent-chat.json (never inside the document, so exported SVGs that carry the
// editable project never carry the chat), and kept in this browser between visits until then.
// Text only: snapshots and images are never stored.
import { BATCH } from '../core/batch-mode';
import { CHAT_EXTRA } from '../io/extras';
import type { AgentErrorKind, Msg } from './clients/types';
import { type Outcome, compactHistory } from './loop';
import type { StepView } from './describe';
import type { AgentRequest } from './request';

export interface Turn {
  id: number;
  /** what the user typed */
  user: string;
  /** the files attached to it (in Assets), for its thumbnails and coloured references */
  att?: { id: string; name: string; kind: 'image' | 'svg' }[];
  /** what the agent said before its steps (its earlier answers), and its last answer */
  pre?: string;
  reply: string;
  model: string;
  steps: StepView[];
  outcome?: Outcome;
  error?: { kind: AgentErrorKind; message: string };
  /** at the step limit: what the agent says is left, one step per line */
  left?: string[];
  /** steps allowed so far (the limit, plus what each Continue added) */
  budget?: number;
  /** where each Continue started, as indexes into steps */
  cont?: number[];
  /** "Make it as an image instead": this vector request was undone and redone as an image */
  replaced?: boolean;
  /** this request redoes the one before it as an image */
  redo?: boolean;
  /** the request changed the project */
  changed?: boolean;
  /** the messages it added, for the next request's history */
  msgs: Msg[];
}

export const CHAT_FILE = CHAT_EXTRA;
const KEY = 'svgcinema:agent.chat',
  MAX_TURNS = 50;

export const CHAT: { turns: Turn[]; next: number } = { turns: [], next: 1 };
/** the undo step of each request this visit (not stored: undo history doesn't survive a reload) */
export const REQUESTS = new Map<number, AgentRequest>();

/** Text only and bounded, so the chat stays small in storage and in the project file. */
function lean(t: Turn): Turn {
  return {
    ...t,
    // the panel shows label and meta; the raw arguments and results (an SVG, a scene) aren't kept
    steps: t.steps.map(s => ({ ...s, args: undefined, result: undefined, image: undefined })),
    msgs: compactHistory(t.msgs, 1000).map(m =>
      m.role === 'tool' && m.content.length > 2000 ? { ...m, content: m.content.slice(0, 2000) + '…' } : m,
    ),
  };
}

export function chatJSON() {
  return JSON.stringify({ format: 'svgcinema-agent-chat', version: 1, turns: CHAT.turns.slice(-MAX_TURNS).map(lean) });
}
export function loadChat(text: string | null) {
  CHAT.turns = [];
  REQUESTS.clear();
  try {
    const j = text ? JSON.parse(text) : null;
    if (j && j.format === 'svgcinema-agent-chat' && Array.isArray(j.turns))
      CHAT.turns = j.turns.filter((t: any) => t && typeof t.user === 'string' && Array.isArray(t.msgs));
  } catch (_) {
    CHAT.turns = [];
  }
  CHAT.next = CHAT.turns.reduce((m, t) => Math.max(m, t.id || 0), 0) + 1;
}
export function persistChat() {
  if (BATCH) return;
  try {
    if (CHAT.turns.length) localStorage.setItem(KEY, chatJSON());
    else localStorage.removeItem(KEY);
  } catch (_) {
    /* full storage: it is still saved into the project file */
  }
}
export function restoreChat() {
  if (BATCH) return;
  try {
    loadChat(localStorage.getItem(KEY));
  } catch (_) {
    loadChat(null);
  }
}
export function clearChat() {
  const old = { turns: CHAT.turns, next: CHAT.next };
  CHAT.turns = [];
  REQUESTS.clear();
  persistChat();
  return old;
}

/** Earlier messages to send with the next request. */
export function chatHistory(): Msg[] {
  return compactHistory(CHAT.turns.flatMap(t => t.msgs));
}
