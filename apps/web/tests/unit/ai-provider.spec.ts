/**
 * The provider transport, driven by real `fetch` against a real HTTP server.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `src/lib/ai/provider.ts` is pure translation between two wire formats, and
 * translation code fails in exactly the way a mock cannot see: it produces a
 * well-formed request that the far end rejects, or reads a field the far end
 * spells differently and quietly returns zero. A `vi.mock('fetch')` here would
 * assert that our own object literal matches our own expectation of it.
 *
 * So this stands up an HTTP server that speaks each protocol, records the exact
 * bytes it received, and replies in the vendor's own response shape. What is
 * exercised is the real `fetch`, the real JSON serialisation, and the real
 * field names — only the model is in memory.
 *
 * The four things worth this much apparatus, all of which a naive translation
 * gets wrong:
 *
 *   · Tool arguments are a JSON **string** on OpenAI-compatible APIs and an
 *     **object** on Google. Sending the wrong one is accepted by some gateways
 *     and rejected by others, so it fails in production and not in staging.
 *   · Tool *results* are correlated by an opaque `tool_call_id` on OpenAI and
 *     by function **name** on Google. Google emits no ids, so one has to be
 *     synthesised — and a round that calls the same tool twice is where a
 *     name-keyed implementation loses a result.
 *   · Token usage is `usageMetadata.promptTokenCount` on one and
 *     `usage.prompt_tokens` on the other. Reading the wrong one meters zero,
 *     which looks exactly like a workspace that is not using the feature.
 *   · The system prompt is a separate `systemInstruction` field on Google and
 *     the first `messages[]` entry on OpenAI. Dropped, the assistant loses
 *     every one of its rules including "answer only from tool data".
 *
 * ── What this does not prove ────────────────────────────────────────────────
 *
 * That openrouter.ai behaves the way this server does. The shapes are
 * implemented from the OpenAI chat-completions contract OpenRouter serves; this
 * environment's egress policy denies that host, so no request has been made to
 * it. A field OpenRouter spells differently from the contract would not be
 * caught here. That needs one live call with a real key and is recorded as
 * exactly that.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  generateStructured,
  generateWithTools,
  type AiTransportCredential,
  type ToolDeclaration,
  type Turn,
} from '@/lib/ai/provider';

/** Every request body the fake provider received, newest last. */
const received: { path: string; auth: string | undefined; body: any }[] = [];
/** What the next response should be, per path suffix. */
let googleReply: unknown = {};
let openRouterReply: unknown = {};
let status = 200;

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      received.push({
        path: req.url ?? '',
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : null,
      });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(req.url?.includes('/chat/completions') ? openRouterReply : googleReply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.AI_GOOGLE_BASE_URL = `${base}/v1beta/models`;
  process.env.AI_OPENROUTER_URL = `${base}/api/v1/chat/completions`;
});

afterAll(async () => {
  delete process.env.AI_GOOGLE_BASE_URL;
  delete process.env.AI_OPENROUTER_URL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received.length = 0;
  status = 200;
});

const google: AiTransportCredential = { key: 'google-key', provider: 'google' };
const openrouter: AiTransportCredential = { key: 'or-key', provider: 'openrouter' };

const TOOLS: ToolDeclaration[] = [
  { name: 'searchLeads', description: 'Search leads', parameters: { type: 'object', properties: {} } },
  { name: 'getLead', description: 'One lead', parameters: { type: 'object', properties: {} } },
];

const last = () => received[received.length - 1]!;

describe('structured generation', () => {
  it('sends the Google shape and reads Google’s usage names', async () => {
    googleReply = {
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5, totalTokenCount: 16 },
    };
    const out = await generateStructured({
      credential: google,
      model: 'gemini-flash-latest',
      prompt: 'summarise',
      schema: { type: 'object' },
    });

    expect(out.text).toBe('{"ok":true}');
    expect(out.usage).toEqual({ promptTokens: 11, completionTokens: 5, totalTokens: 16 });
    // The key is a query parameter on Google, never a Bearer token.
    expect(last().path).toContain('gemini-flash-latest:generateContent?key=google-key');
    expect(last().auth).toBeUndefined();
    expect(last().body.contents[0].parts[0].text).toBe('summarise');
    expect(last().body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('sends the OpenAI shape and reads OpenRouter’s usage names', async () => {
    openRouterReply = {
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
    };
    const out = await generateStructured({
      credential: openrouter,
      model: 'google/gemini-2.0-flash-001',
      prompt: 'summarise',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      maxOutputTokens: 900,
    });

    expect(out.text).toBe('{"ok":true}');
    expect(out.usage).toEqual({ promptTokens: 11, completionTokens: 5, totalTokens: 16 });
    expect(last().auth).toBe('Bearer or-key');
    expect(last().body.model).toBe('google/gemini-2.0-flash-001');
    // `max_tokens`, not `maxOutputTokens` — the wrong name is ignored silently
    // and the model runs to its own default.
    expect(last().body.max_tokens).toBe(900);
    // The schema has to reach the model somehow; on this path it rides in the
    // prompt, because `response_format: json_schema` is not universally served.
    expect(last().body.response_format).toEqual({ type: 'json_object' });
    expect(last().body.messages[0].content).toContain('"ok"');
  });

  it('totals the usage itself when the provider omits the total', async () => {
    googleReply = {
      candidates: [{ content: { parts: [{ text: '{}' }] } }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
    };
    const google1 = await generateStructured({ credential: google, model: 'm', prompt: 'p', schema: {} });
    expect(google1.usage.totalTokens).toBe(10);

    openRouterReply = { choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } };
    const or1 = await generateStructured({ credential: openrouter, model: 'm', prompt: 'p', schema: {} });
    expect(or1.usage.totalTokens).toBe(10);
  });

  it('reports zero rather than NaN when a provider sends no usage at all', async () => {
    openRouterReply = { choices: [{ message: { content: '{}' } }] };
    const out = await generateStructured({ credential: openrouter, model: 'm', prompt: 'p', schema: {} });
    expect(out.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('carries the HTTP status onto the error, so 429 stays distinguishable', async () => {
    status = 429;
    openRouterReply = { error: { message: 'rate limited' } };
    await expect(
      generateStructured({ credential: openrouter, model: 'm', prompt: 'p', schema: {} }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('refuses an empty completion rather than returning an empty string to parse', async () => {
    openRouterReply = { choices: [{ message: { content: '' } }] };
    await expect(generateStructured({ credential: openrouter, model: 'm', prompt: 'p', schema: {} })).rejects.toThrow(
      /Empty response/,
    );
  });
});

describe('tool calling', () => {
  it('puts the system prompt where each provider looks for it', async () => {
    googleReply = { candidates: [{ content: { parts: [{ text: 'hi' }] } }] };
    await generateWithTools({
      credential: google,
      model: 'm',
      system: 'RULES: answer only from tools',
      turns: [{ role: 'user', text: 'who?' }],
      tools: TOOLS,
    });
    expect(last().body.systemInstruction.parts[0].text).toContain('answer only from tools');

    openRouterReply = { choices: [{ message: { content: 'hi' } }] };
    await generateWithTools({
      credential: openrouter,
      model: 'm',
      system: 'RULES: answer only from tools',
      turns: [{ role: 'user', text: 'who?' }],
      tools: TOOLS,
    });
    expect(last().body.messages[0]).toEqual({ role: 'system', content: 'RULES: answer only from tools' });
  });

  it('declares tools in each provider’s own envelope', async () => {
    googleReply = { candidates: [{ content: { parts: [] } }] };
    await generateWithTools({ credential: google, model: 'm', system: 's', turns: [], tools: TOOLS });
    expect(last().body.tools[0].functionDeclarations.map((f: any) => f.name)).toEqual(['searchLeads', 'getLead']);

    openRouterReply = { choices: [{ message: {} }] };
    await generateWithTools({ credential: openrouter, model: 'm', system: 's', turns: [], tools: TOOLS });
    expect(last().body.tools.map((t: any) => [t.type, t.function.name])).toEqual([
      ['function', 'searchLeads'],
      ['function', 'getLead'],
    ]);
  });

  it('reads a Google functionCall and synthesises an id for it', async () => {
    googleReply = {
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: 'searchLeads', args: { view: 'mine' } } },
              { functionCall: { name: 'searchLeads', args: { view: 'unassigned' } } },
            ],
          },
        },
      ],
    };
    const out = await generateWithTools({ credential: google, model: 'm', system: 's', turns: [], tools: TOOLS });
    expect(out.calls.map((c) => c.args)).toEqual([{ view: 'mine' }, { view: 'unassigned' }]);
    // Two calls to one tool in one round: ids must differ, or the results
    // cannot be told apart on the way back.
    expect(new Set(out.calls.map((c) => c.id)).size).toBe(2);
  });

  it('parses OpenAI tool arguments out of their JSON string', async () => {
    openRouterReply = {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'call_abc', type: 'function', function: { name: 'getLead', arguments: '{"leadId":"L-1"}' } },
            ],
          },
        },
      ],
    };
    const out = await generateWithTools({ credential: openrouter, model: 'm', system: 's', turns: [], tools: TOOLS });
    expect(out.calls).toEqual([{ id: 'call_abc', name: 'getLead', args: { leadId: 'L-1' } }]);
    expect(out.text).toBe('');
  });

  it('drops one unparseable tool call rather than the whole conversation', async () => {
    openRouterReply = {
      choices: [
        {
          message: {
            tool_calls: [
              { id: 'a', type: 'function', function: { name: 'getLead', arguments: '{"leadId": ' } },
              { id: 'b', type: 'function', function: { name: 'searchLeads', arguments: '{"view":"mine"}' } },
            ],
          },
        },
      ],
    };
    const out = await generateWithTools({ credential: openrouter, model: 'm', system: 's', turns: [], tools: TOOLS });
    expect(out.calls).toEqual([
      { id: 'a', name: 'getLead', args: {} },
      { id: 'b', name: 'searchLeads', args: { view: 'mine' } },
    ]);
  });

  const conversation: Turn[] = [
    { role: 'user', text: 'who is hot?' },
    { role: 'model', calls: [{ id: 'call_1', name: 'searchLeads', args: { view: 'high_score' } }] },
    { role: 'tool', results: [{ id: 'call_1', name: 'searchLeads', data: { count: 2 } }] },
  ];

  it('replays a tool result as a Google functionResponse on a user turn', async () => {
    googleReply = { candidates: [{ content: { parts: [{ text: 'two' }] } }] };
    await generateWithTools({ credential: google, model: 'm', system: 's', turns: conversation, tools: TOOLS });

    const contents = last().body.contents;
    expect(contents[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'searchLeads', args: { view: 'high_score' } } }],
    });
    // Google has no `tool` role; the result comes back as a user turn.
    expect(contents[2].role).toBe('user');
    expect(contents[2].parts[0].functionResponse).toEqual({ name: 'searchLeads', response: { data: { count: 2 } } });
  });

  it('replays a tool result as an OpenAI tool message carrying its call id', async () => {
    openRouterReply = { choices: [{ message: { content: 'two' } }] };
    await generateWithTools({ credential: openrouter, model: 'm', system: 's', turns: conversation, tools: TOOLS });

    const messages = last().body.messages;
    expect(messages[2].role).toBe('assistant');
    expect(messages[2].tool_calls[0].id).toBe('call_1');
    // Arguments are a string here. An object is rejected by strict gateways.
    expect(messages[2].tool_calls[0].function.arguments).toBe('{"view":"high_score"}');
    expect(messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      name: 'searchLeads',
      content: '{"count":2}',
    });
  });

  it('meters a tool round on both providers', async () => {
    googleReply = {
      candidates: [{ content: { parts: [{ text: 'x' }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
    };
    const g = await generateWithTools({ credential: google, model: 'm', system: 's', turns: [], tools: TOOLS });
    expect(g.usage.totalTokens).toBe(120);

    openRouterReply = {
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    };
    const o = await generateWithTools({ credential: openrouter, model: 'm', system: 's', turns: [], tools: TOOLS });
    expect(o.usage.totalTokens).toBe(120);
  });
});
