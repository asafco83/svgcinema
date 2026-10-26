// SVGcinema — agent/clients/anthropic
// Anthropic's Messages API with tool use, streamed, called from the browser with the user's own key
// (the API allows direct browser calls with the anthropic-dangerous-direct-browser-access header).
import {
  AgentError,
  type Client,
  type ModelReply,
  type Msg,
  type SendRequest,
  type ToolCall,
  guardedFetch,
  httpError,
  parseArgs,
  readSSE,
} from './types';

export interface AnthropicOptions {
  key: string;
  model: string;
  url?: string;
  maxTokens?: number;
  idleMs?: number;
}

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/** Our messages in the Messages API shape. Tool results ride in a user message; consecutive user
 *  content (the results of one turn, or a new message after a request that ended early) shares one,
 *  since the API wants user and assistant turns to alternate. */
export function toAnthropic(messages: Msg[]) {
  const out: any[] = [];
  const toUser = (blocks: any[]) => {
    const last = out[out.length - 1];
    if (last && last.role === 'user') last.content.push(...blocks);
    else out.push({ role: 'user', content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'user') {
      const content =
        typeof m.content === 'string'
          ? [{ type: 'text', text: m.content }]
          : m.content.map(p =>
              p.type === 'text'
                ? { type: 'text', text: p.text }
                : { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } },
            );
      toUser(content);
    } else if (m.role === 'assistant') {
      const content: any[] = [];
      if (m.text) content.push({ type: 'text', text: m.text });
      m.calls.forEach(c => content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} }));
      if (!content.length) content.push({ type: 'text', text: '…' });
      out.push({ role: 'assistant', content });
    } else {
      toUser([
        {
          type: 'tool_result',
          tool_use_id: m.id,
          content: m.image
            ? [
                { type: 'text', text: m.content },
                { type: 'image', source: { type: 'base64', media_type: m.image.mime, data: m.image.data } },
              ]
            : m.content,
          ...(m.error ? { is_error: true } : {}),
        },
      ]);
    }
  }
  return out;
}

const STOPS: Record<string, ModelReply['stop']> = {
  end_turn: 'end',
  stop_sequence: 'end',
  tool_use: 'tools',
  max_tokens: 'length',
};

export function anthropicClient(o: AnthropicOptions): Client {
  return {
    provider: 'Anthropic',
    model: o.model,
    async send(r: SendRequest): Promise<ModelReply> {
      const body = {
        model: o.model,
        max_tokens: o.maxTokens ?? 8192,
        system: r.system,
        messages: toAnthropic(r.messages),
        stream: true,
        ...(r.tools.length
          ? { tools: r.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
          : {}),
      };
      const g = guardedFetch(
        o.url || ANTHROPIC_URL,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': o.key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify(body),
        },
        r.signal,
        o.idleMs ?? 90000,
      );
      try {
        const res = await g.res;
        if (!res.ok) throw await httpError(res, 'Anthropic');
        let text = '',
          stop = '';
        const blocks: Array<{ type: string; id?: string; name?: string; json: string }> = [];
        await readSSE(res, g.touch, (ev, data) => {
          let j: any;
          try {
            j = JSON.parse(data);
          } catch (_) {
            return;
          }
          const type = j.type || ev;
          if (type === 'error')
            throw new AgentError(
              j.error && j.error.type === 'overloaded_error' ? 'rate' : 'provider',
              `Anthropic: ${(j.error && j.error.message) || 'the reply failed'}`,
            );
          if (type === 'content_block_start') {
            const b = j.content_block || {};
            blocks[j.index] = { type: b.type, id: b.id, name: b.name, json: '' };
            if (b.type === 'text' && b.text) {
              text += b.text;
              if (r.onText) r.onText(b.text);
            }
          } else if (type === 'content_block_delta') {
            const d = j.delta || {},
              b = blocks[j.index];
            if (d.type === 'text_delta' && d.text) {
              text += d.text;
              if (r.onText) r.onText(d.text);
            } else if (d.type === 'input_json_delta' && b) b.json += d.partial_json || '';
          } else if (type === 'message_delta') {
            if (j.delta && j.delta.stop_reason) stop = j.delta.stop_reason;
          }
        });
        const calls: ToolCall[] = blocks
          .filter(b => b && b.type === 'tool_use' && b.name)
          .map(b => {
            const a = parseArgs(b.json);
            return { id: b.id as string, name: b.name as string, args: a.args, ...(a.bad ? { bad: a.bad } : {}) };
          });
        return { text, calls, stop: calls.length ? 'tools' : STOPS[stop] || (stop ? 'other' : 'end') };
      } catch (e) {
        throw g.why(e, 'Anthropic');
      } finally {
        g.done();
      }
    },
  };
}
