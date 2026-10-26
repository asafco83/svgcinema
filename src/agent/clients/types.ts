// SVGcinema — agent/clients/types
// One message format for the whole agent. Each provider client turns it into its own wire format
// (OpenAI-compatible chat completions, or Anthropic messages) and turns the streamed answer back.

/** A piece of a user message: text, or an image (a snapshot of the canvas). */
export type Part = { type: 'text'; text: string } | { type: 'image'; mime: string; data: string };

export interface ToolCall {
  id: string;
  name: string;
  /** parsed arguments (an empty object when the model sent none) */
  args: any;
  /** set when the model's arguments were not valid JSON */
  bad?: string;
}

export type Msg =
  | { role: 'user'; content: string | Part[] }
  | { role: 'assistant'; text: string; calls: ToolCall[] }
  | { role: 'tool'; id: string; name: string; content: string; error?: boolean };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: any;
}

export interface SendRequest {
  system: string;
  messages: Msg[];
  tools: ToolSpec[];
  signal?: AbortSignal;
  /** streamed text as it arrives */
  onText?: (delta: string) => void;
}

export interface ModelReply {
  text: string;
  calls: ToolCall[];
  /** why the model stopped: it is done, it wants tools run, it ran out of room */
  stop: 'end' | 'tools' | 'length' | 'other';
}

export interface Client {
  /** provider id, for messages */
  provider: string;
  model: string;
  send(r: SendRequest): Promise<ModelReply>;
}

/** What went wrong talking to a provider, in a form the panel can explain. */
export type AgentErrorKind = 'auth' | 'rate' | 'network' | 'timeout' | 'aborted' | 'provider' | 'format';

export class AgentError extends Error {
  constructor(
    public kind: AgentErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** Turn an HTTP error response into an AgentError with the provider's own message when it gives one. */
export async function httpError(res: Response, provider: string): Promise<AgentError> {
  let detail = '';
  try {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      detail = (j && j.error && (j.error.message || j.error)) || j.message || '';
      if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch (_) {
      detail = t.slice(0, 300);
    }
  } catch (_) {
    /* no body */
  }
  const s = res.status;
  if (s === 401 || s === 403)
    return new AgentError('auth', `${provider} refused the key${detail ? `: ${detail}` : '.'}`, s);
  if (s === 429)
    return new AgentError('rate', `${provider} is busy or your limit is reached${detail ? `: ${detail}` : '.'}`, s);
  return new AgentError('provider', `${provider} answered ${s}${detail ? `: ${detail}` : ''}`, s);
}

/**
 * fetch with Stop and an inactivity timeout: `signal` is the user's Stop; the request is also cut
 * when nothing arrives for `idleMs`. Returns the response and a `touch()` to call on every chunk read.
 */
export function guardedFetch(url: string, init: RequestInit, signal: AbortSignal | undefined, idleMs: number) {
  const ctl = new AbortController();
  let timedOut = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, idleMs);
  };
  const onStop = () => ctl.abort();
  if (signal) {
    if (signal.aborted) ctl.abort();
    else signal.addEventListener('abort', onStop, { once: true });
  }
  const done = () => {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onStop);
  };
  const why = (e: unknown, provider: string) => {
    if (e instanceof AgentError) return e;
    if (signal && signal.aborted) return new AgentError('aborted', 'Stopped.');
    if (timedOut) return new AgentError('timeout', `${provider} stopped answering (no reply for ${idleMs / 1000} s).`);
    return new AgentError(
      'network',
      `Couldn't reach ${provider}. Check the connection, or whether this service allows calls from a web page.`,
    );
  };
  touch();
  const res = fetch(url, { ...init, signal: ctl.signal });
  return { res, touch, done, why };
}

/** Read a server-sent-events stream: calls onEvent(eventName, data) per event. */
export async function readSSE(res: Response, touch: () => void, onEvent: (event: string, data: string) => void) {
  if (!res.body) throw new AgentError('format', 'The reply had no body.');
  const reader = res.body.getReader(),
    dec = new TextDecoder();
  let buf = '';
  const flush = (block: string) => {
    let ev = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length) onEvent(ev, data.join('\n'));
  };
  for (;;) {
    const { value, done } = await reader.read();
    touch();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const m = buf.match(/\r?\n\r?\n/) as RegExpMatchArray;
      flush(buf.slice(0, i));
      buf = buf.slice(i + m[0].length);
    }
  }
  if (buf.trim()) flush(buf);
}

/** Parse a tool call's arguments; a model that sends broken JSON gets told so instead of crashing. */
export function parseArgs(s: string): { args: any; bad?: string } {
  if (!s || !s.trim()) return { args: {} };
  try {
    return { args: JSON.parse(s) };
  } catch (_) {
    return { args: {}, bad: 'The arguments were not valid JSON.' };
  }
}
