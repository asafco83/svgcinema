// SVGcinema — agent/loop
// Runs one request: send the conversation and tools to the model, run the tool calls it makes one by
// one, send the results back, and repeat until it answers without tools, the step cap is reached,
// the user presses Stop, or the provider fails. However it ends, the request is one undo step.
import type { AgentError, Client, ModelReply, Msg, Part } from './clients/types';
import { AgentError as Err } from './clients/types';
import { systemPrompt, userTurn } from './prompt';
import { type AgentRequest, beginRequest, endRequest } from './request';
import { type ToolContext, type ToolResult, resultText, runTool, toolSpecs } from './tools';

export const MAX_STEPS = 20;

export interface StepEvent {
  /** 1-based, in the order they ran */
  index: number;
  name: string;
  args: any;
  ok: boolean;
  result?: any;
  error?: string;
  /** a picture the tool returned (a snapshot), for the panel's thumbnail */
  image?: { mime: string; data: string };
}

export type Outcome = 'done' | 'cap' | 'stopped' | 'error' | 'length';

export interface RunOptions {
  client: Client;
  /** what the user typed */
  text: string;
  /** earlier messages of this chat (compacted with compactHistory) */
  history?: Msg[];
  /** tool names to offer (default: all) */
  tools?: string[];
  system?: string;
  maxSteps?: number;
  signal?: AbortSignal;
  ctx?: ToolContext;
  onText?: (delta: string) => void;
  onStep?: (s: StepEvent) => void;
  /** each model answer once it is complete (its text, and whether it asked for tools) */
  onReply?: (r: ModelReply) => void;
  /** test hooks: how tools run, and how the undo step opens and closes */
  run?: (name: string, args: any, ctx: ToolContext) => Promise<ToolResult>;
  begin?: () => AgentRequest;
  end?: (r: AgentRequest) => boolean;
  /** how the user's message is built (default: with the scene attached) */
  turn?: (text: string) => string;
  /** pictures sent with the user's message (attached files, for a model that can see) */
  images?: Part[];
}

export interface RunResult {
  /** the messages this request added (user, assistant, tool results) */
  added: Msg[];
  steps: StepEvent[];
  outcome: Outcome;
  error?: AgentError;
  /** the last thing the model said */
  reply: string;
  /** at the step cap: what the agent says is left, one step per line (undefined: it didn't say) */
  left?: string[];
  /** the document changed (so there is an undo step) */
  changed: boolean;
  request: AgentRequest;
}

const CAP_NOTE =
  ' (The step limit for this request is reached: do not call any more tools. In one or two sentences tell the user what you did, then list what is left inside <left></left>, one line per step (one tool call each), for example:\n<left>\n- Animate the star across the sky\n- Move it behind the planet\n</left>\nWrite an empty <left></left> if nothing is left. The user can press Continue to let you finish.)';

/** Split a capped answer into what the user reads and the list of steps left. */
export function parseLeft(text: string): { text: string; left?: string[] } {
  const m = /<left>([\s\S]*?)(?:<\/left>|$)/i.exec(text || '');
  if (!m) return { text };
  const left = m[1]
    .split('\n')
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  return { text: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\n{3,}/g, '\n\n').trim(), left };
}

export async function runAgent(o: RunOptions): Promise<RunResult> {
  const run = o.run || runTool,
    max = o.maxSteps ?? MAX_STEPS,
    specs = toolSpecs(o.tools),
    system = o.system ?? systemPrompt(),
    msgs: Msg[] = [...(o.history || [])],
    added: Msg[] = [],
    steps: StepEvent[] = [];
  const push = (m: Msg) => {
    msgs.push(m);
    added.push(m);
  };
  const req = (o.begin || beginRequest)();
  let outcome: Outcome = 'done',
    error: AgentError | undefined,
    reply = '',
    left: string[] | undefined;
  const said = (o.turn || userTurn)(o.text);
  push({ role: 'user', content: o.images && o.images.length ? [{ type: 'text', text: said }, ...o.images] : said });
  try {
    for (;;) {
      if (o.signal && o.signal.aborted) {
        outcome = 'stopped';
        break;
      }
      const capped = steps.length >= max;
      const r0 = await o.client.send({ system, messages: msgs, tools: specs, signal: o.signal, onText: o.onText });
      // past the cap the answer is the last word (calls it still makes don't run); its list of what is
      // left comes apart from the text
      const cut = capped ? parseLeft(r0.text) : null,
        r = cut ? { ...r0, text: cut.text, calls: [] } : r0;
      if (cut) left = cut.left;
      if (r.text) reply = r.text;
      if (o.onReply) o.onReply(r);
      // past the cap nothing more runs, so no calls are recorded either (each call needs a result)
      push({ role: 'assistant', text: r0.text, calls: r.calls });
      if (capped) {
        // it says nothing is left: the request is done after all
        outcome = left && !left.length ? 'done' : 'cap';
        break;
      }
      if (!r.calls.length) {
        outcome = r.stop === 'length' ? 'length' : 'done';
        break;
      }
      let stopped = false;
      for (const c of r.calls) {
        // every call gets an answer, even ones that don't run, so the conversation stays valid
        if (stopped || (o.signal && o.signal.aborted)) {
          stopped = true;
          push({ role: 'tool', id: c.id, name: c.name, content: '{"error":"Stopped by the user."}', error: true });
          continue;
        }
        if (steps.length >= max) {
          push({ role: 'tool', id: c.id, name: c.name, content: `{"error":"Not run."}${CAP_NOTE}`, error: true });
          continue;
        }
        const res: ToolResult = c.bad ? { ok: false, error: c.bad } : await run(c.name, c.args, o.ctx || {});
        const ev: StepEvent = {
          index: steps.length + 1,
          name: c.name,
          args: c.args,
          ok: res.ok,
          ...('error' in res ? { error: res.error } : { result: res.result }),
          ...('image' in res && res.image ? { image: res.image } : {}),
        };
        steps.push(ev);
        if (o.onStep) o.onStep(ev);
        push({
          role: 'tool',
          id: c.id,
          name: c.name,
          content: resultText(res) + (steps.length >= max ? CAP_NOTE : ''),
          error: !res.ok,
          ...('image' in res && res.image ? { image: res.image } : {}),
        });
      }
      if (stopped) {
        outcome = 'stopped';
        break;
      }
    }
  } catch (e) {
    const ae = e instanceof Err ? e : new Err('provider', String((e && (e as Error).message) || e));
    if (ae.kind === 'aborted') outcome = 'stopped';
    else {
      outcome = 'error';
      error = ae;
    }
  }
  const changed = (o.end || endRequest)(req);
  return { added, steps, outcome, error, reply, changed, request: req, ...(left ? { left } : {}) };
}

/**
 * Earlier messages, ready to send with the next request: the last `turns` user turns, older scene
 * attachments dropped (a fresh one rides with every request) and long tool results shortened.
 */
export function compactHistory(msgs: Msg[], turns = 10): Msg[] {
  const starts = msgs.map((m, i) => (m.role === 'user' ? i : -1)).filter(i => i >= 0);
  // a turn starts at a user message that isn't a tool result; keep whole turns only
  const from = starts.length > turns ? starts[starts.length - turns] : 0;
  return msgs.slice(from).map((m): Msg => {
    if (m.role === 'user') {
      // the scene rode with that request only; so did attached pictures (their names and ids stay)
      const lean = (t: string) => t.replace(/\n*<project note=[\s\S]*?<\/project>\s*$/, ''),
        c = m.content;
      if (typeof c === 'string') return { ...m, content: lean(c) };
      return {
        ...m,
        content: lean(
          c
            .filter(p => p.type === 'text')
            .map(p => (p as { text: string }).text)
            .join('\n\n'),
        ),
      };
    }
    // big arguments (an SVG the model wrote) don't need sending again
    if (m.role === 'assistant' && m.calls.some(c => JSON.stringify(c.args || {}).length > 2000))
      return {
        ...m,
        calls: m.calls.map(c =>
          JSON.stringify(c.args || {}).length > 2000 ? { ...c, args: { note: 'arguments shortened' } } : c,
        ),
      };
    // pictures (snapshots) are only sent within their own request
    if (m.role === 'tool' && (m.content.length > 300 || m.image)) {
      const { image, ...rest } = m;
      return m.content.length > 300 ? { ...rest, content: m.content.slice(0, 240) + '… (shortened)' } : rest;
    }
    return m;
  });
}
