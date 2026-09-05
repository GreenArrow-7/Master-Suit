import { logger } from '../logger';
import { PRODUCT_NAME } from '@/lib/branding';

/**
 * The one place that knows an AI provider's wire format.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Six call sites had this URL written into them:
 *
 *     https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}
 *
 * — analysis, audit, liveCoach, generate, assistant/service and
 * social/draftReply. That is fine while Google is the only provider, and it
 * silently stops being fine the moment somebody connects a key from anywhere
 * else: OpenRouter is an OpenAI-compatible endpoint, so the key is a Bearer
 * token, the body is `messages` rather than `contents`, tool arguments arrive
 * as a JSON *string* rather than an object, and token usage is reported under
 * different names. A key pasted into the wrong shape does not fail loudly — it
 * 400s, every feature falls back to simulation, and Settings → Integrations
 * goes on saying Connected. That exact failure has already happened once in
 * this codebase, when `gemini-2.0-flash` was retired out from under a hardcoded
 * default.
 *
 * So the transport lives here, both dialects are translated to one neutral
 * shape, and no feature learns that a second provider exists.
 *
 * ── What is NOT verified ────────────────────────────────────────────────────
 *
 * The OpenRouter request and response shapes here are implemented from the
 * OpenAI chat-completions contract that OpenRouter serves, and are exercised by
 * `tests/unit/ai-provider.spec.ts` against a local server speaking that
 * protocol — real `fetch`, real JSON, only the far end is in memory. They have
 * NOT been run against openrouter.ai itself, because this build environment's
 * egress policy denies that host. Treat the first live call as the real
 * acceptance test; the failure it would show is a 4xx, not a wrong answer.
 */

export type AiProviderKey = 'google' | 'openrouter';

/** Normalised token accounting. Each provider reports it under its own names. */
export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const NO_USAGE: ModelUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

export interface AiTransportCredential {
  key: string;
  provider: AiProviderKey;
}

/**
 * One tool call the model wants made.
 *
 * `id` is the part that does not survive naive translation. OpenAI-compatible
 * APIs correlate a tool *result* to its call by an opaque id and reject a
 * result carrying an unknown one; Google has no ids at all and matches by
 * function name, which breaks as soon as one round calls the same tool twice.
 * So ids are synthesised for Google and passed through for OpenRouter, and the
 * neutral conversation below always carries them.
 */
export interface ModelToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  /** JSON Schema object, the subset both providers accept. */
  parameters: Record<string, unknown>;
}

/** One entry of the conversation, in neither provider's vocabulary. */
export type Turn =
  | { role: 'user'; text: string }
  | { role: 'model'; text?: string; calls?: ModelToolCall[] }
  | { role: 'tool'; results: { id: string; name: string; data: unknown }[] };

export interface ModelError extends Error {
  status?: number;
}

const fail = (message: string, status?: number): ModelError => {
  const err: ModelError = new Error(message);
  err.status = status;
  return err;
};

/** Hard ceiling on one round-trip; a hung provider fails its one feature. */
const DEFAULT_TIMEOUT_MS = 60_000;

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Test seam, and deliberately inert in production.
 *
 * A test needs this code path pointed at a local server — mocking `fetch` would
 * prove only that the mock was called. But an environment variable that
 * redirects where every prompt and every API key is sent is not something to
 * leave live on a deployment: it turns one compromised env file into silent
 * exfiltration of transcripts. So outside production it is honoured, and in
 * production the constants are the only answer.
 */
export const ENDPOINTS = {
  googleBase: () =>
    process.env.NODE_ENV === 'production' ? GOOGLE_BASE : process.env.AI_GOOGLE_BASE_URL || GOOGLE_BASE,
  openRouter: () =>
    process.env.NODE_ENV === 'production' ? OPENROUTER_URL : process.env.AI_OPENROUTER_URL || OPENROUTER_URL,
};

/**
 * OpenRouter attributes requests to an app on its public leaderboards using
 * these two headers. They are optional, and omitting them attributes the
 * traffic to nobody — which makes a deployment's usage harder to recognise in
 * OpenRouter's own console, the place an operator goes to answer "what is this
 * costing".
 */
function openRouterHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    // Shown in the workspace owner's OpenRouter dashboard, so it names the
    // product they bought rather than the one it used to be called.
    'X-Title': PRODUCT_NAME,
  };
  const referer = process.env.APP_URL;
  if (referer) headers['HTTP-Referer'] = referer;
  return headers;
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw fail(`AI provider error ${res.status} — ${detail.slice(0, 200)}`, res.status);
  }
  return res.json();
}

// ── Structured (JSON-schema) generation ──────────────────────────────────────

export interface TextRequest {
  credential: AiTransportCredential;
  model: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface StructuredRequest extends TextRequest {
  /** JSON Schema for the expected object. */
  schema: object;
}

export interface StructuredResponse {
  /** Raw model text. The caller parses it, exactly as it did before. */
  text: string;
  usage: ModelUsage;
}

/**
 * A prompt in, JSON out, against a schema the provider is asked to honour.
 */
export function generateStructured(request: StructuredRequest): Promise<StructuredResponse> {
  return complete(request, request.schema);
}

/**
 * A prompt in, prose out. Same transport, no schema — asking for JSON here
 * would make the model wrap a sentence in quotes and braces, and the callers on
 * this path (a suggested reply somebody reads and edits) want the sentence.
 */
export function generateText(request: TextRequest): Promise<StructuredResponse> {
  return complete(request, undefined);
}

async function complete(request: TextRequest, schema: object | undefined): Promise<StructuredResponse> {
  const { credential, model, prompt } = request;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const temperature = request.temperature ?? 0.3;
  const maxOutputTokens = request.maxOutputTokens ?? 2048;

  if (credential.provider === 'openrouter') {
    /**
     * `json_object`, not `json_schema`, and the schema goes in the prompt.
     *
     * OpenRouter fronts many providers and `response_format: {type:
     * 'json_schema'}` is honoured only by the subset that declares structured
     * output; sending it to one that does not is a 400, which would take a
     * working feature offline for a model choice an operator made in a settings
     * field. `json_object` is accepted across the board and constrains the
     * response to *valid JSON*; the shape is then steered by the schema in the
     * prompt. That is weaker than Google's constrained decoding — the model can
     * return well-formed JSON of the wrong shape — and the caller's parse is
     * what catches it, the same parse that has always been there.
     */
    const data = await post(
      ENDPOINTS.openRouter(),
      openRouterHeaders(credential.key),
      {
        model,
        messages: [
          {
            role: 'user',
            content: schema
              ? `${prompt}\n\nRespond with JSON only, matching this JSON Schema exactly:\n${JSON.stringify(schema)}`
              : prompt,
          },
        ],
        ...(schema ? { response_format: { type: 'json_object' } } : {}),
        temperature,
        max_tokens: maxOutputTokens,
      },
      timeoutMs,
    );
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw fail('Empty response from the AI provider');
    return { text, usage: openRouterUsage(data?.usage) };
  }

  const data = await post(
    `${ENDPOINTS.googleBase()}/${model}:generateContent?key=${credential.key}`,
    { 'Content-Type': 'application/json' },
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}),
        temperature,
        maxOutputTokens,
      },
    },
    timeoutMs,
  );
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || !text.trim()) throw fail('Empty response from the AI provider');
  return { text, usage: googleUsage(data?.usageMetadata) };
}

// ── Tool-calling generation ──────────────────────────────────────────────────

export interface ToolTurnRequest {
  credential: AiTransportCredential;
  model: string;
  system: string;
  turns: Turn[];
  tools: ToolDeclaration[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface ToolTurnResponse {
  text: string;
  calls: ModelToolCall[];
  usage: ModelUsage;
}

export async function generateWithTools(request: ToolTurnRequest): Promise<ToolTurnResponse> {
  const { credential, model, system, turns, tools } = request;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const temperature = request.temperature ?? 0.2;
  const maxOutputTokens = request.maxOutputTokens ?? 2048;

  if (credential.provider === 'openrouter') {
    const data = await post(
      ENDPOINTS.openRouter(),
      openRouterHeaders(credential.key),
      {
        model,
        messages: [{ role: 'system', content: system }, ...toOpenAiMessages(turns)],
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        temperature,
        max_tokens: maxOutputTokens,
      },
      timeoutMs,
    );
    const message = data?.choices?.[0]?.message ?? {};
    return {
      text: typeof message.content === 'string' ? message.content : '',
      calls: fromOpenAiToolCalls(message.tool_calls),
      usage: openRouterUsage(data?.usage),
    };
  }

  const data = await post(
    `${ENDPOINTS.googleBase()}/${model}:generateContent?key=${credential.key}`,
    { 'Content-Type': 'application/json' },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: toGoogleContents(turns),
      tools: [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ],
      generationConfig: { temperature, maxOutputTokens },
    },
    timeoutMs,
  );
  const parts = (data?.candidates?.[0]?.content?.parts ?? []) as {
    text?: string;
    functionCall?: { name?: string; args?: Record<string, unknown> };
  }[];
  return {
    text: parts.map((p) => p.text ?? '').join(''),
    calls: parts
      .filter((p) => p.functionCall?.name)
      .map((p, index) => ({
        // Google returns no id. One is synthesised so the neutral conversation
        // can correlate results even when a round calls one tool twice.
        id: `${p.functionCall!.name}-${index}`,
        name: p.functionCall!.name!,
        args: p.functionCall!.args ?? {},
      })),
    usage: googleUsage(data?.usageMetadata),
  };
}

// ── Translation ──────────────────────────────────────────────────────────────

function toGoogleContents(turns: Turn[]): unknown[] {
  return turns.map((turn) => {
    if (turn.role === 'user') return { role: 'user', parts: [{ text: turn.text }] };
    if (turn.role === 'model') {
      const parts: unknown[] = [];
      if (turn.text) parts.push({ text: turn.text });
      for (const call of turn.calls ?? []) parts.push({ functionCall: { name: call.name, args: call.args } });
      return { role: 'model', parts };
    }
    // Google carries tool results on a *user* turn, matched by function name.
    return {
      role: 'user',
      parts: turn.results.map((r) => ({ functionResponse: { name: r.name, response: { data: r.data } } })),
    };
  });
}

function toOpenAiMessages(turns: Turn[]): unknown[] {
  const messages: unknown[] = [];
  for (const turn of turns) {
    if (turn.role === 'user') {
      messages.push({ role: 'user', content: turn.text });
    } else if (turn.role === 'model') {
      messages.push({
        role: 'assistant',
        content: turn.text ?? null,
        ...(turn.calls?.length
          ? {
              tool_calls: turn.calls.map((c) => ({
                id: c.id,
                type: 'function',
                // Arguments travel as a JSON *string* here and as an object on
                // Google. Sending the object is silently accepted by some
                // gateways and rejected by others.
                function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      // One message per result, each naming the call it answers. A result with
      // no matching id is rejected by the API, which is why ids are carried
      // through the neutral turn rather than regenerated here.
      for (const result of turn.results) {
        messages.push({
          role: 'tool',
          tool_call_id: result.id,
          name: result.name,
          content: JSON.stringify(result.data ?? null),
        });
      }
    }
  }
  return messages;
}

function fromOpenAiToolCalls(raw: unknown): ModelToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ModelToolCall[] = [];
  for (const [index, entry] of raw.entries()) {
    const fn = (entry as { function?: { name?: string; arguments?: unknown } })?.function;
    if (!fn?.name) continue;
    calls.push({
      id: (entry as { id?: string }).id || `${fn.name}-${index}`,
      name: fn.name,
      args: parseArguments(fn.arguments, fn.name),
    });
  }
  return calls;
}

/**
 * A malformed `arguments` string loses one tool call, not the whole answer.
 *
 * Models do emit invalid JSON here, and the surrounding loop can still finish:
 * the tool runs with no arguments, most likely returns "not found", and the
 * model gets a chance to correct itself on the next round. Throwing would end
 * the conversation on a provider-side formatting slip.
 */
function parseArguments(raw: unknown, tool: string): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    logger.warn({ tool }, 'model returned unparseable tool arguments');
    return {};
  }
}

/**
 * Exported for the call sites that still issue their own Google fetch. Each one
 * loses this line as it moves onto the transport above; until then the meter
 * takes one shape rather than two.
 */
export function googleUsage(raw: unknown): ModelUsage {
  const usage = raw as { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | null;
  if (!usage) return NO_USAGE;
  const promptTokens = usage.promptTokenCount ?? 0;
  const completionTokens = usage.candidatesTokenCount ?? 0;
  return { promptTokens, completionTokens, totalTokens: usage.totalTokenCount ?? promptTokens + completionTokens };
}

function openRouterUsage(raw: unknown): ModelUsage {
  const usage = raw as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  if (!usage) return NO_USAGE;
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  return { promptTokens, completionTokens, totalTokens: usage.total_tokens ?? promptTokens + completionTokens };
}
