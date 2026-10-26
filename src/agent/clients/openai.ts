// SVGcinema — agent/clients/openai
// OpenAI-compatible chat completions with tool calls, streamed. One client covers OpenRouter, OpenAI,
// Groq, Gemini (its OpenAI-compatible endpoint) and Custom services. Called straight from the browser
// with the user's own key.
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

export interface OpenAIOptions {
  /** provider name for messages ("OpenRouter") */
  provider: string;
  /** full chat completions URL */
  url: string;
  key: string;
  model: string;
  /** extra request headers (OpenRouter's attribution headers) */
  headers?: Record<string, string>;
  /** ms with nothing arriving before the call is given up */
  idleMs?: number;
}

/** Our messages in the chat completions shape. */
export function toOpenAI(system: string, messages: Msg[]) {
  const out: any[] = [{ role: 'system', content: system }],
    pics: Array<{ id: string; mime: string; data: string }> = [];
  for (const m of messages) {
    if (m.role === 'user')
      out.push({
        role: 'user',
        content:
          typeof m.content === 'string'
            ? m.content
            : m.content.map(p =>
                p.type === 'text'
                  ? { type: 'text', text: p.text }
                  : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } },
              ),
      });
    else if (m.role === 'assistant')
      out.push({
        role: 'assistant',
        content: m.text || null,
        ...(m.calls.length
          ? {
              tool_calls: m.calls.map(c => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
              })),
            }
          : {}),
      });
    else {
      out.push({ role: 'tool', tool_call_id: m.id, content: m.content });
      // a tool message can only hold text, so a picture a tool returned (a snapshot) follows the tool
      // results as a user message
      if (m.image) pics.push({ id: m.id, ...m.image });
    }
    const next = messages[messages.indexOf(m) + 1];
    if (pics.length && (!next || next.role !== 'tool')) {
      out.push({
        role: 'user',
        content: pics.flatMap(p => [
          { type: 'text', text: `The picture returned by tool call ${p.id}:` },
          { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } },
        ]),
      });
      pics.length = 0;
    }
  }
  return out;
}

const STOPS: Record<string, ModelReply['stop']> = { stop: 'end', tool_calls: 'tools', length: 'length' };

export function openAIClient(o: OpenAIOptions): Client {
  return {
    provider: o.provider,
    model: o.model,
    async send(r: SendRequest): Promise<ModelReply> {
      const body = {
        model: o.model,
        messages: toOpenAI(r.system, r.messages),
        stream: true,
        ...(r.tools.length
          ? {
              tools: r.tools.map(t => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
      };
      const g = guardedFetch(
        o.url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(o.key ? { authorization: `Bearer ${o.key}` } : {}),
            ...(o.headers || {}),
          },
          body: JSON.stringify(body),
        },
        r.signal,
        o.idleMs ?? 90000,
      );
      try {
        const res = await g.res;
        if (!res.ok) throw await httpError(res, o.provider);
        let text = '',
          finish = '';
        const parts: Array<{ id: string; name: string; args: string }> = [];
        // a server that ignores stream: true answers with one JSON body
        if (!/event-stream/.test(res.headers.get('content-type') || '')) {
          const j = await res.json();
          const c = j.choices && j.choices[0];
          if (!c) throw new AgentError('format', `${o.provider} sent a reply without an answer.`);
          text = (c.message && c.message.content) || '';
          if (text && r.onText) r.onText(text);
          ((c.message && c.message.tool_calls) || []).forEach((t: any) =>
            parts.push({ id: t.id, name: t.function.name, args: t.function.arguments || '' }),
          );
          finish = c.finish_reason || '';
        } else {
          await readSSE(res, g.touch, (_ev, data) => {
            if (data === '[DONE]') return;
            let j: any;
            try {
              j = JSON.parse(data);
            } catch (_) {
              return;
            }
            if (j.error)
              throw new AgentError('provider', `${o.provider}: ${j.error.message || JSON.stringify(j.error)}`);
            const c = j.choices && j.choices[0];
            if (!c) return;
            const d = c.delta || {};
            if (d.content) {
              text += d.content;
              if (r.onText) r.onText(d.content);
            }
            for (const t of d.tool_calls || []) {
              const i = t.index ?? parts.length;
              const p = (parts[i] = parts[i] || { id: '', name: '', args: '' });
              if (t.id) p.id = t.id;
              if (t.function && t.function.name) p.name += t.function.name;
              if (t.function && t.function.arguments) p.args += t.function.arguments;
            }
            if (c.finish_reason) finish = c.finish_reason;
          });
        }
        const calls: ToolCall[] = parts
          .filter(p => p && p.name)
          .map((p, i) => {
            const a = parseArgs(p.args);
            return { id: p.id || `call_${i}`, name: p.name, args: a.args, ...(a.bad ? { bad: a.bad } : {}) };
          });
        return { text, calls, stop: calls.length ? 'tools' : STOPS[finish] || (finish ? 'other' : 'end') };
      } catch (e) {
        throw g.why(e, o.provider);
      } finally {
        g.done();
      }
    },
  };
}
