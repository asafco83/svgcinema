import { describe, it, expect, vi, afterEach } from 'vitest';
import { openAIClient, toOpenAI } from '../src/agent/clients/openai';
import { anthropicClient, toAnthropic } from '../src/agent/clients/anthropic';
import { AgentError, type Client, type ModelReply, type Msg } from '../src/agent/clients/types';
import { compactHistory, parseLeft, runAgent } from '../src/agent/loop';
import { customChatUrl, makeClient } from '../src/agent/providers';
import type { AgentRequest } from '../src/agent/request';

/** A streamed reply: each event's `data:` payload, cut into uneven chunks to test reassembly. */
function sse(events: Array<string | [string, unknown]>, signal?: AbortSignal | null) {
  const text = events
    .map(e => (typeof e === 'string' ? `data: ${e}\n\n` : `event: ${e[0]}\ndata: ${JSON.stringify(e[1])}\n\n`))
    .join('');
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
        if (signal) signal.addEventListener('abort', () => 0);
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
const chunk = (delta: unknown, finish: string | null = null) =>
  JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] });

let calls: Array<{ url: string; init: any }> = [];
function mockFetch(make: (url: string, init: any) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      return make(url, init);
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

const tools = [{ name: 'get_scene', description: 'The project', parameters: { type: 'object', properties: {} } }];

describe('OpenAI-compatible client', () => {
  it('streams text and reassembles tool calls split across chunks', async () => {
    mockFetch(() =>
      sse([
        chunk({ role: 'assistant', content: 'Making ' }),
        chunk({ content: 'a rocket.' }),
        chunk({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'add_shape', arguments: '{"kind":' } }] }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: '"rect","x":1}' } }] }),
        chunk({ tool_calls: [{ index: 1, id: 'c2', function: { name: 'get_scene', arguments: '' } }] }),
        chunk({}, 'tool_calls'),
        '[DONE]',
      ]),
    );
    const seen: string[] = [];
    const c = openAIClient({ provider: 'OpenRouter', url: 'https://x.test/v1/chat/completions', key: 'k', model: 'm' });
    const r = await c.send({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools,
      onText: t => seen.push(t),
    });
    expect(r.text).toBe('Making a rocket.');
    expect(seen.join('')).toBe('Making a rocket.');
    expect(r.calls).toEqual([
      { id: 'c1', name: 'add_shape', args: { kind: 'rect', x: 1 } },
      { id: 'c2', name: 'get_scene', args: {} },
    ]);
    expect(r.stop).toBe('tools');
    const body = JSON.parse(calls[0].init.body);
    expect(calls[0].init.headers.authorization).toBe('Bearer k');
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.tools[0]).toEqual({ type: 'function', function: tools[0] });
  });
  it('reads a plain JSON answer from a server that does not stream', async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: 'ok',
                  tool_calls: [{ id: 't', function: { name: 'seek', arguments: '{"time":1}' } }],
                },
                finish_reason: 'tool_calls',
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    const r = await openAIClient({ provider: 'X', url: 'u', key: '', model: 'm' }).send({
      system: '',
      messages: [],
      tools: [],
    });
    expect(r).toEqual({ text: 'ok', calls: [{ id: 't', name: 'seek', args: { time: 1 } }], stop: 'tools' });
    expect(calls[0].init.headers.authorization).toBeUndefined();
  });
  it('marks arguments that are not JSON instead of failing', async () => {
    mockFetch(() =>
      sse([chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'seek', arguments: '{time:' } }] }), '[DONE]']),
    );
    const r = await openAIClient({ provider: 'X', url: 'u', key: 'k', model: 'm' }).send({
      system: '',
      messages: [],
      tools,
    });
    expect(r.calls[0].bad).toMatch(/not valid JSON/);
  });
  it('maps the conversation: assistant tool calls and their results', () => {
    const m: Msg[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', text: '', calls: [{ id: 'a', name: 'seek', args: { time: 1 } }] },
      { role: 'tool', id: 'a', name: 'seek', content: '{"time":1}' },
    ];
    expect(toOpenAI('s', m)).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'a', type: 'function', function: { name: 'seek', arguments: '{"time":1}' } }],
      },
      { role: 'tool', tool_call_id: 'a', content: '{"time":1}' },
    ]);
  });
});

describe('Anthropic client', () => {
  it('streams text and tool use, with the browser-access headers', async () => {
    mockFetch(() =>
      sse([
        ['message_start', { type: 'message_start', message: { id: 'm' } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        [
          'content_block_delta',
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'On it.' } },
        ],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        [
          'content_block_start',
          {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'tool_use', id: 'tu1', name: 'seek', input: {} },
          },
        ],
        [
          'content_block_delta',
          { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"ti' } },
        ],
        [
          'content_block_delta',
          { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'me":0.5}' } },
        ],
        ['ping', { type: 'ping' }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' } }],
        ['message_stop', { type: 'message_stop' }],
      ]),
    );
    const r = await anthropicClient({ key: 'sk', model: 'claude-x' }).send({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools,
    });
    expect(r).toEqual({ text: 'On it.', calls: [{ id: 'tu1', name: 'seek', args: { time: 0.5 } }], stop: 'tools' });
    const h = calls[0].init.headers,
      body = JSON.parse(calls[0].init.body);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(h['x-api-key']).toBe('sk');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(body.system).toBe('sys');
    expect(body.tools[0]).toEqual({ name: 'get_scene', description: 'The project', input_schema: tools[0].parameters });
  });
  it('puts tool results in one user turn and keeps turns alternating', () => {
    const m: Msg[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        text: 'ok',
        calls: [
          { id: 'a', name: 'seek', args: { time: 1 } },
          { id: 'b', name: 'get_scene', args: {} },
        ],
      },
      { role: 'tool', id: 'a', name: 'seek', content: '1' },
      { role: 'tool', id: 'b', name: 'get_scene', content: '{}', error: true },
      { role: 'user', content: 'next' },
    ];
    const out = toAnthropic(m);
    expect(out.map(x => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(out[1].content).toEqual([
      { type: 'text', text: 'ok' },
      { type: 'tool_use', id: 'a', name: 'seek', input: { time: 1 } },
      { type: 'tool_use', id: 'b', name: 'get_scene', input: {} },
    ]);
    expect(out[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: '1' },
      { type: 'tool_result', tool_use_id: 'b', content: '{}', is_error: true },
      { type: 'text', text: 'next' },
    ]);
  });
  it('reports a stream error event', async () => {
    mockFetch(() => sse([['error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]]));
    await expect(
      anthropicClient({ key: 'k', model: 'm' }).send({ system: '', messages: [], tools: [] }),
    ).rejects.toMatchObject({ kind: 'rate', message: 'Anthropic: Overloaded' });
  });
});

describe('provider errors', () => {
  const client = () => openAIClient({ provider: 'Groq', url: 'u', key: 'k', model: 'm', idleMs: 60 });
  const send = () => client().send({ system: '', messages: [], tools: [] });
  it('a refused key', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 }));
    await expect(send()).rejects.toMatchObject({ kind: 'auth', message: 'Groq refused the key: Invalid API Key' });
  });
  it('a rate limit', async () => {
    mockFetch(() => new Response('slow down', { status: 429 }));
    await expect(send()).rejects.toMatchObject({ kind: 'rate', status: 429 });
  });
  it('another failure keeps the provider message', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 }));
    await expect(send()).rejects.toMatchObject({ kind: 'provider', message: 'Groq answered 404: model not found' });
  });
  it('no connection (or a service that blocks web pages)', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(send()).rejects.toMatchObject({ kind: 'network' });
  });
  it('a provider that goes quiet', async () => {
    mockFetch(
      (_u, init) =>
        new Response(
          new ReadableStream({
            start(c) {
              init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    await expect(send()).rejects.toMatchObject({ kind: 'timeout' });
  });
  it('Stop', async () => {
    const ctl = new AbortController();
    mockFetch(
      (_u, init) =>
        new Response(
          new ReadableStream({
            start(c) {
              init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
              setTimeout(() => ctl.abort(), 5);
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    await expect(
      openAIClient({ provider: 'X', url: 'u', key: 'k', model: 'm' }).send({
        system: '',
        messages: [],
        tools: [],
        signal: ctl.signal,
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('providers', () => {
  it('Custom addresses get the chat completions path once', () => {
    expect(customChatUrl('https://api.mistral.ai/v1/')).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(customChatUrl('http://localhost:11434/v1/chat/completions')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });
  it('OpenRouter names the app; Anthropic gets its own client', async () => {
    mockFetch(() => sse(['[DONE]']));
    await makeClient({ provider: 'openrouter', model: 'm', key: 'k' }).send({ system: '', messages: [], tools: [] });
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].init.headers['X-Title']).toBe('SVGcinema');
    expect(makeClient({ provider: 'anthropic', model: 'm', key: 'k' }).provider).toBe('Anthropic');
  });
});

/* ---------- the loop, with a scripted model and stand-in tools ---------- */

function scripted(replies: ModelReply[]) {
  const sent: Msg[][] = [];
  const c: Client & { sent: Msg[][] } = {
    provider: 'Test',
    model: 'm',
    sent,
    async send(r) {
      sent.push(r.messages.slice());
      const next = replies.shift();
      if (!next) throw new Error('no more replies');
      if (next.text && r.onText) r.onText(next.text);
      return next;
    },
  };
  return c;
}
const call = (id: string, name: string, args: any = {}) => ({ id, name, args });
function harness() {
  const ran: string[] = [];
  let ended = 0;
  return {
    ran,
    ended: () => ended,
    hooks: {
      run: async (n: string, a: any) => {
        ran.push(n);
        return n === 'fails' ? { ok: false as const, error: 'nope' } : { ok: true as const, result: { n, a } };
      },
      begin: () => ({ snap: '', mark: undefined, depth: 0, open: true }) as AgentRequest,
      end: () => {
        ended++;
        return true;
      },
      turn: (t: string) => t,
      system: 'sys',
    },
  };
}

describe('the agent loop', () => {
  it('runs the calls in order, sends results back, and ends when the model answers', async () => {
    const h = harness();
    const c = scripted([
      { text: 'Let me look.', calls: [call('1', 'get_scene'), call('2', 'fails')], stop: 'tools' },
      { text: 'Done: added a box.', calls: [], stop: 'end' },
    ]);
    const steps: string[] = [];
    const r = await runAgent({
      client: c,
      text: 'add a box',
      ...h.hooks,
      onStep: s => steps.push(`${s.index}:${s.name}:${s.ok}`),
    });
    expect(h.ran).toEqual(['get_scene', 'fails']);
    expect(steps).toEqual(['1:get_scene:true', '2:fails:false']);
    expect(r.outcome).toBe('done');
    expect(r.reply).toBe('Done: added a box.');
    expect(h.ended()).toBe(1);
    // the second request carries both results, the failure marked as an error
    const tools2 = c.sent[1].filter(m => m.role === 'tool') as any[];
    expect(tools2.map(m => [m.id, m.error])).toEqual([
      ['1', false],
      ['2', true],
    ]);
    expect(tools2[1].content).toBe('{"error":"nope"}');
    expect(r.added.map(m => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant']);
  });
  it('stops at the step cap: extra calls are answered but not run, then one last turn', async () => {
    const h = harness();
    const c = scripted([
      { text: '', calls: [call('1', 'a'), call('2', 'b'), call('3', 'c')], stop: 'tools' },
      { text: 'I ran out of steps; the rest is left.', calls: [call('4', 'd')], stop: 'tools' },
    ]);
    const r = await runAgent({ client: c, text: 'x', ...h.hooks, maxSteps: 2 });
    expect(h.ran).toEqual(['a', 'b']);
    expect(r.outcome).toBe('cap');
    expect(r.steps.length).toBe(2);
    const t = c.sent[1].filter(m => m.role === 'tool') as any[];
    expect(t[1].content).toMatch(/step limit/);
    expect(t[2].content).toMatch(/Not run/);
    expect(r.reply).toBe('I ran out of steps; the rest is left.');
    // the capped turn's own calls are dropped, so every recorded call has a result
    expect((r.added[r.added.length - 1] as any).calls).toEqual([]);
    expect(h.ended()).toBe(1);
  });
  it('at the cap the agent lists what is left: kept apart from the text it says', async () => {
    const h = harness();
    const c = scripted([
      { text: '', calls: [call('1', 'a'), call('2', 'b')], stop: 'tools' },
      {
        text: 'I drew the star but ran out of steps.\n<left>\n- Animate it across the sky\n2. Move it behind the planet\n</left>',
        calls: [call('3', 'c')],
        stop: 'tools',
      },
    ]);
    const replies: string[] = [];
    const r = await runAgent({ client: c, text: 'x', ...h.hooks, maxSteps: 2, onReply: m => replies.push(m.text) });
    expect(r.outcome).toBe('cap');
    expect(r.reply).toBe('I drew the star but ran out of steps.');
    expect(r.left).toEqual(['Animate it across the sky', 'Move it behind the planet']);
    // the panel gets the last answer without its calls (they don't run), so it reads as the last word
    expect(replies[replies.length - 1]).toBe('I drew the star but ran out of steps.');
    // the model's own list stays in the history, so Continue knows the plan
    expect((r.added[r.added.length - 1] as any).text).toMatch(/<left>/);
    expect((c.sent[1].filter(m => m.role === 'tool') as any[])[1].content).toMatch(/<left><\/left>/);
  });
  it('at the cap with nothing left the request is done; with no list, nothing is guessed', async () => {
    const h = harness();
    let r = await runAgent({
      client: scripted([
        { text: '', calls: [call('1', 'a')], stop: 'tools' },
        { text: 'All done.\n<left></left>', calls: [], stop: 'end' },
      ]),
      text: 'x',
      ...h.hooks,
      maxSteps: 1,
    });
    expect(r.outcome).toBe('done');
    expect(r.reply).toBe('All done.');
    r = await runAgent({
      client: scripted([
        { text: '', calls: [call('1', 'a')], stop: 'tools' },
        { text: 'Out of steps.', calls: [], stop: 'end' },
      ]),
      text: 'x',
      ...h.hooks,
      maxSteps: 1,
    });
    expect(r.outcome).toBe('cap');
    expect(r.left).toBeUndefined();
  });
  it('parseLeft: bullets, numbers and an unclosed list', () => {
    expect(parseLeft('Hi')).toEqual({ text: 'Hi' });
    expect(parseLeft('A.\n<left>\n* one\n• two\n3) three')).toEqual({ text: 'A.', left: ['one', 'two', 'three'] });
    expect(parseLeft('<LEFT>- x</LEFT>\nThen more.')).toEqual({ text: 'Then more.', left: ['x'] });
  });
  it('Stop between tools: the rest are answered as stopped, and the request still closes', async () => {
    const h = harness(),
      ctl = new AbortController();
    const c = scripted([{ text: '', calls: [call('1', 'a'), call('2', 'b'), call('3', 'c')], stop: 'tools' }]);
    const r = await runAgent({
      client: c,
      text: 'x',
      ...h.hooks,
      signal: ctl.signal,
      run: async n => {
        h.ran.push(n);
        ctl.abort();
        return { ok: true, result: {} };
      },
    });
    expect(h.ran).toEqual(['a']);
    expect(r.outcome).toBe('stopped');
    expect(r.added.filter(m => m.role === 'tool').map((m: any) => m.content)).toEqual([
      '{}',
      '{"error":"Stopped by the user."}',
      '{"error":"Stopped by the user."}',
    ]);
    expect(h.ended()).toBe(1);
  });
  it('a provider failure ends the request with the reason', async () => {
    const h = harness();
    const c: Client = {
      provider: 'X',
      model: 'm',
      send: async () => {
        throw new AgentError('auth', 'X refused the key.');
      },
    };
    const r = await runAgent({ client: c, text: 'x', ...h.hooks });
    expect(r.outcome).toBe('error');
    expect(r.error && r.error.kind).toBe('auth');
    expect(h.ended()).toBe(1);
  });
  it('a call with broken arguments is refused without running', async () => {
    const h = harness();
    const c = scripted([
      {
        text: '',
        calls: [{ id: '1', name: 'seek', args: {}, bad: 'The arguments were not valid JSON.' }],
        stop: 'tools',
      },
      { text: 'Sorry.', calls: [], stop: 'end' },
    ]);
    const r = await runAgent({ client: c, text: 'x', ...h.hooks });
    expect(h.ran).toEqual([]);
    expect(r.steps[0]).toMatchObject({ ok: false, error: 'The arguments were not valid JSON.' });
  });
});

describe('chat history', () => {
  it('keeps the last turns, drops old scene attachments, shortens long results', () => {
    const m: Msg[] = [];
    for (let i = 0; i < 12; i++) {
      m.push({ role: 'user', content: `turn ${i}\n\n<project note="x">{"layers":[]}</project>` });
      m.push({ role: 'assistant', text: '', calls: [call(`c${i}`, 'get_scene')] });
      m.push({ role: 'tool', id: `c${i}`, name: 'get_scene', content: 'y'.repeat(1000) });
      m.push({ role: 'assistant', text: `ok ${i}`, calls: [] });
    }
    const c = compactHistory(m, 10);
    expect(c[0]).toEqual({ role: 'user', content: 'turn 2' });
    expect(c.length).toBe(40);
    expect((c[2] as any).content.length).toBeLessThan(300);
    expect((c[2] as any).content).toMatch(/shortened/);
  });
});
