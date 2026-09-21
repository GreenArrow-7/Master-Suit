import { prisma } from '../db';
import { redis } from '../redis';
import { logger } from '../logger';
import { redact } from './redact';

/**
 * Guardrails at the one seam every model request passes through.
 *
 * Four rules, each with somewhere to act. A guardrail that can only be observed
 * is a report, not a control, so the catalogue deliberately stops at what this
 * code can actually refuse, redact or throttle; the portal can switch a rule
 * off or tighten its number, and the rest is a deploy.
 *
 * `locked` marks a platform-mandatory control. A company may make it stricter
 * and may never switch it off, which is why it is a column rather than a note
 * in a runbook: the resolver refuses to read an override that weakens one.
 */
export type GuardrailKey = 'pii_redaction' | 'prompt_injection' | 'max_input_chars' | 'rate_limit_per_min';

export interface GuardrailDefinition {
  key: GuardrailKey;
  label: string;
  help: string;
  /** Platform-mandatory: strengthen it, never switch it off. */
  locked: boolean;
  defaultEnabled: boolean;
  defaultConfig: Record<string, number>;
}

export const GUARDRAILS: GuardrailDefinition[] = [
  {
    key: 'pii_redaction',
    label: 'Strip personal data before it leaves the deployment',
    help: 'Card numbers, national identifiers, emails and phone numbers are replaced with typed placeholders on the way to the provider. Mandatory: it may not be switched off for any company.',
    locked: true,
    defaultEnabled: true,
    defaultConfig: {},
  },
  {
    key: 'prompt_injection',
    label: 'Refuse a prompt that carries instructions aimed at the model',
    help: 'Customer text — a transcript, an email, a note — is data. A request whose untrusted portion tries to give the model orders is refused and recorded rather than sent.',
    locked: true,
    defaultEnabled: true,
    defaultConfig: {},
  },
  {
    key: 'max_input_chars',
    label: 'Largest prompt sent to a provider',
    help: 'A runaway transcript is the usual cause of a surprise bill. Above this size the request is refused before it is billed.',
    locked: false,
    defaultEnabled: true,
    defaultConfig: { chars: 120_000 },
  },
  {
    key: 'rate_limit_per_min',
    label: 'Model requests a company may make each minute',
    help: 'A loop in an integration can spend a month of allowance in an hour. Above this rate the request is refused for the rest of the minute.',
    locked: false,
    defaultEnabled: true,
    defaultConfig: { requests: 120 },
  },
];

export const GUARDRAIL_BY_KEY = new Map(GUARDRAILS.map((g) => [g.key, g]));

export interface EffectiveGuardrail {
  key: GuardrailKey;
  enabled: boolean;
  locked: boolean;
  config: Record<string, number>;
  /** Where the effective value came from, for the portal's "set by" column. */
  source: 'default' | 'platform' | 'tenant' | 'feature';
}

/**
 * The rule in force for this company and feature: the definition's default,
 * then the platform row, then the company's, then the feature's — each layer
 * able to tighten, none able to switch off a locked control.
 */
export async function effectiveGuardrails(
  tenantId?: string | null,
  feature?: string | null,
): Promise<Map<GuardrailKey, EffectiveGuardrail>> {
  const rows = await prisma.aiGuardrailPolicy.findMany({
    where: {
      OR: [
        { scope: 'PLATFORM' },
        ...(tenantId ? [{ scope: 'TENANT', scopeId: tenantId }] : []),
        ...(feature ? [{ scope: 'FEATURE', scopeId: feature }] : []),
      ],
    },
  });
  const order = { PLATFORM: 0, TENANT: 1, FEATURE: 2 } as Record<string, number>;
  const sorted = [...rows].sort((a, b) => (order[a.scope] ?? 0) - (order[b.scope] ?? 0));

  const out = new Map<GuardrailKey, EffectiveGuardrail>();
  for (const def of GUARDRAILS) {
    out.set(def.key, {
      key: def.key,
      enabled: def.defaultEnabled,
      locked: def.locked,
      config: { ...def.defaultConfig },
      source: 'default',
    });
  }
  for (const row of sorted) {
    const current = out.get(row.key as GuardrailKey);
    if (!current) continue; // A key the code no longer knows how to enforce.
    const source = row.scope === 'PLATFORM' ? 'platform' : row.scope === 'TENANT' ? 'tenant' : 'feature';
    // A locked control may be turned on by an override and never off.
    const enabled = current.locked ? current.enabled || row.enabled : row.enabled;
    out.set(row.key as GuardrailKey, {
      ...current,
      enabled,
      locked: current.locked || row.locked,
      config: { ...current.config, ...(row.config as Record<string, number>) },
      source,
    });
  }
  return out;
}

/**
 * Phrases whose only purpose is to address the model rather than describe the
 * customer's business. Kept narrow on purpose: a seller really does say "ignore
 * that, let me start again" on a call, so the pattern requires the sentence to
 * name the instructions, the rules or the system itself.
 */
const INJECTION = [
  /ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+|the\s+)?(previous|prior|above|system)\s+(instructions?|prompts?|rules?)/i,
  /\byou\s+are\s+now\s+(a|an|in)\b.{0,40}\b(mode|assistant|developer|dan)\b/i,
  /\b(system|developer)\s*(prompt|message)\s*[:=]/i,
  /reveal\s+(your|the)\s+(system\s+)?(prompt|instructions)/i,
];

export interface GuardrailVerdict {
  allowed: boolean;
  /** GUARDRAIL_<key>, the vocabulary the event table and the portal filter on. */
  reason: string | null;
  message: string | null;
  /** The prompt to send — redaction may have rewritten the untrusted span. */
  prompt: string;
  /** What was actually replaced, by category; never the values. */
  redacted: Record<string, number>;
  /** What was found anywhere in the prompt, replaced or not. Reporting only. */
  detected: Record<string, number>;
}

/**
 * Applies the rules in force to one request. `untrusted` is the part that came
 * from a customer — a transcript, an email body — and is the only part searched
 * for instructions aimed at the model; the prompt this codebase wrote around it
 * legitimately contains instructions.
 */
export async function applyGuardrails(input: {
  prompt: string;
  untrusted?: string | null;
  tenantId?: string | null;
  feature: string;
}): Promise<GuardrailVerdict> {
  const rules = await effectiveGuardrails(input.tenantId, input.feature);
  let prompt = input.prompt;
  let redacted: Record<string, number> = {};
  let detected: Record<string, number> = {};

  const size = rules.get('max_input_chars');
  if (size?.enabled && prompt.length > (size.config.chars ?? Infinity)) {
    return {
      allowed: false,
      reason: 'GUARDRAIL_max_input_chars',
      message: 'This request is too large to send to the AI provider. Shorten it and try again.',
      prompt,
      redacted,
      detected,
    };
  }

  const injection = rules.get('prompt_injection');
  if (injection?.enabled && input.untrusted && INJECTION.some((p) => p.test(input.untrusted!))) {
    return {
      allowed: false,
      reason: 'GUARDRAIL_prompt_injection',
      message: 'This content could not be sent to the AI provider because it contains instructions aimed at the model.',
      prompt,
      redacted,
      detected,
    };
  }

  const pii = rules.get('pii_redaction');
  if (pii?.enabled) {
    // Only the untrusted span is rewritten, and only where the caller has told
    // us which span that is. A blanket `redact()` over the finished prompt is
    // the one thing this seam must not do: the prompts this codebase writes
    // legitimately carry a client's email to reply to or a number to quote back,
    // and silently replacing them would corrupt the answer rather than protect
    // anyone. What the caller built, the caller redacted (see `followUpEmail`).
    //
    // Everywhere else the rule still counts what it sees, so the portal can say
    // "this feature keeps sending card numbers" without a feature having to
    // break first.
    detected = redact(prompt).counts;
    if (input.untrusted) {
      const report = redact(input.untrusted);
      if (report.text !== input.untrusted && prompt.includes(input.untrusted)) {
        // split/join, not String.replace: a replacement string expands `$&` and
        // `$1`, and a transcript really can contain them, so a customer's own
        // text could rewrite itself into the prompt. It also replaces only the
        // first occurrence, and a prompt may quote the same span twice.
        prompt = prompt.split(input.untrusted).join(report.text);
        redacted = report.counts;
      }
    }
  }

  const rate = rules.get('rate_limit_per_min');
  if (rate?.enabled && input.tenantId) {
    const limit = rate.config.requests ?? Infinity;
    const key = `ai:rate:${input.tenantId}:${Math.floor(Date.now() / 60_000)}`;
    // A Redis fault must not refuse customer work — the ceiling is a safety
    // rail, and the budget below it still bounds the spend.
    const count = await redis
      .incr(key)
      .then(async (n) => {
        if (n === 1) await redis.expire(key, 120).catch(() => {});
        return n;
      })
      .catch((err) => {
        logger.warn({ err: (err as Error).message }, 'could not apply the AI rate guardrail');
        return 0;
      });
    if (count > limit) {
      return {
        allowed: false,
        reason: 'GUARDRAIL_rate_limit_per_min',
        message: 'Too many AI requests in the last minute. Wait a moment and try again.',
        prompt,
        redacted,
        detected,
      };
    }
  }

  return { allowed: true, reason: null, message: null, prompt, redacted, detected };
}
