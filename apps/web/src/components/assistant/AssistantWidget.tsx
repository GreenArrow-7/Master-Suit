'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import SalesLink from '@/components/workspace/SalesLink';

type EntityType = 'lead' | 'account' | 'contact' | 'opportunity' | 'call';

interface Source {
  label: string;
  href: string;
}

interface ActionSpec {
  kind: string;
  label: string;
  method: 'POST' | 'PATCH';
  endpoint: string;
  payload: unknown;
}

interface ActionState {
  spec: ActionSpec;
  state: 'pending' | 'busy' | 'done' | 'error' | 'cancelled';
  detail?: string;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  actions?: ActionState[];
  error?: string;
}

const STORAGE_KEY = 'manath-ai-chat';
const OFFLINE = 'AI Assistant is temporarily unavailable. Your CRM data and other features are still available.';

const SINGULAR: Record<string, EntityType> = {
  leads: 'lead',
  accounts: 'account',
  contacts: 'contact',
  opportunities: 'opportunity',
  calls: 'call',
};

const GLOBAL_SUGGESTIONS = [
  'What should I focus on today?',
  'Show my overdue follow-ups',
  'Which leads have breached SLA?',
  'Show my hottest leads',
  'What opportunities close this month?',
  'Summarize my latest recorded call',
];

const LEAD_SUGGESTIONS = [
  'Summarize this client',
  'What happened recently?',
  'Prepare me for a call',
  'Create a follow-up for tomorrow',
];

/** **bold**, _italics_ — inline only. */
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

/** Markdown-lite: paragraphs, "• " bullet groups, inline bold/italic. */
function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`u${blocks.length}`}>
          {bullets.map((b, i) => (
            <li key={i}>{renderInline(b)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('• ')) bullets.push(line.slice(2));
    else {
      flush();
      if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{renderInline(line)}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

function loadStored(): Msg[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Msg[]) : [];
  } catch {
    return [];
  }
}

export default function AssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(loadStored);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Context awareness: /{slug}/sales/{collection}/{id…}
  const match = pathname.match(/^\/[^/]+\/sales\/(leads|accounts|contacts|opportunities|calls)\/([a-z0-9]{20,})/);
  const context = match ? { entityType: SINGULAR[match[1]], entityId: match[2] } : undefined;

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* storage full or unavailable — chat still works */
    }
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Keep the newest content in view.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, status, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** Mutate the streamed assistant message at a fixed index. */
  function patch(idx: number, fn: (m: Msg) => Msg) {
    setMessages((prev) => {
      const next = prev.slice();
      if (next[idx]) next[idx] = fn(next[idx]);
      return next;
    });
  }

  async function stream(history: Msg[]) {
    const idx = history.length; // the assistant message we are about to append
    setMessages([...history, { role: 'assistant', content: '' }]);
    setStreaming(true);
    setStatus(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch('/api/v1/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history
            .filter((m) => m.content.trim())
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.content })),
          ...(context ? { context } : {}),
        }),
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          let event: { type?: string; text?: string; items?: Source[]; action?: ActionSpec; detail?: string };
          try {
            event = JSON.parse(line.slice(5));
          } catch {
            continue;
          }
          if (event.type === 'status') setStatus(event.text ?? '');
          else if (event.type === 'delta') {
            setStatus(null);
            patch(idx, (m) => ({ ...m, content: m.content + (event.text ?? '') }));
          } else if (event.type === 'sources')
            patch(idx, (m) => ({ ...m, sources: [...(m.sources ?? []), ...(event.items ?? [])] }));
          else if (event.type === 'action' && event.action) {
            const spec = event.action;
            patch(idx, (m) => ({ ...m, actions: [...(m.actions ?? []), { spec, state: 'pending' }] }));
          } else if (event.type === 'error') patch(idx, (m) => ({ ...m, error: event.detail ?? OFFLINE }));
          else if (event.type === 'done') return;
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        patch(idx, (m) => ({ ...m, error: OFFLINE }));
    } finally {
      setStreaming(false);
      setStatus(null);
      abortRef.current = null;
    }
  }

  function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    setDraft('');
    void stream([...messages, { role: 'user', content }]);
  }

  /** Re-send the conversation up to (and including) the last user message. */
  function retry() {
    const lastUser = messages.map((m) => m.role).lastIndexOf('user');
    if (lastUser < 0 || streaming) return;
    void stream(messages.slice(0, lastUser + 1));
  }

  function newChat() {
    abortRef.current?.abort();
    setMessages([]);
    setStatus(null);
    setStreaming(false);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    inputRef.current?.focus();
  }

  async function runAction(msgIdx: number, actIdx: number) {
    const action = messages[msgIdx]?.actions?.[actIdx];
    if (!action || action.state !== 'pending') return;
    const setAction = (state: ActionState['state'], detail?: string) =>
      patch(msgIdx, (m) => ({
        ...m,
        actions: m.actions?.map((a, i) => (i === actIdx ? { ...a, state, detail } : a)),
      }));
    setAction('busy');
    try {
      const res = await fetch(action.spec.endpoint, {
        method: action.spec.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action.spec.payload),
      });
      if (res.ok) setAction('done');
      else {
        const body: { detail?: string } | null = await res.json().catch(() => null);
        setAction('error', body?.detail ?? `Request failed (${res.status})`);
      }
    } catch {
      setAction('error', 'Request failed — check your connection.');
    }
  }

  const suggestions =
    context?.entityType === 'lead' ? [...LEAD_SUGGESTIONS, ...GLOBAL_SUGGESTIONS] : GLOBAL_SUGGESTIONS;

  if (!open)
    return (
      <button type="button" className="lf-ai-fab" aria-label="Open Manath AI" onClick={() => setOpen(true)}>
        ✦
      </button>
    );

  return (
    <div className="lf-ai-panel" role="dialog" aria-label="Manath AI">
      <div className="lf-ai-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 'var(--lf-text-base)' }}>Manath AI</strong>
            {context && <span className="lf-badge" data-tone="wine">Viewing: {context.entityType}</span>}
          </div>
          <div style={{ fontSize: 'var(--lf-text-2xs)', color: 'var(--lf-ink-3)' }}>CRM copilot</div>
        </div>
        <button type="button" className="lf-btn lf-btn--ghost lf-btn--sm" onClick={newChat} aria-label="New chat">
          New chat
        </button>
        <button type="button" className="lf-ai-close" onClick={() => setOpen(false)} aria-label="Close Manath AI">
          ×
        </button>
      </div>

      <div className="lf-ai-body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="lf-ai-suggest">
            <span className="lf-eyebrow">Try asking</span>
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((msg, msgIdx) => (
          <div key={msgIdx} className="lf-ai-msg" data-role={msg.role}>
            {msg.role === 'user' ? msg.content : <Markdown text={msg.content} />}
            {msg.sources && msg.sources.length > 0 && (
              <div className="lf-ai-chips">
                {msg.sources.map((source, i) => (
                  <SalesLink key={i} href={source.href}>
                    {source.label}
                  </SalesLink>
                ))}
              </div>
            )}
            {msg.actions?.map((action, actIdx) => (
              <div key={actIdx} className="lf-ai-action">
                <span>{action.spec.label}</span>
                {action.state === 'pending' || action.state === 'busy' ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="lf-btn lf-btn--sm"
                      disabled={action.state === 'busy'}
                      onClick={() => void runAction(msgIdx, actIdx)}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="lf-btn lf-btn--secondary lf-btn--sm"
                      disabled={action.state === 'busy'}
                      onClick={() =>
                        patch(msgIdx, (m) => ({
                          ...m,
                          actions: m.actions?.map((a, i) => (i === actIdx ? { ...a, state: 'cancelled' } : a)),
                        }))
                      }
                    >
                      Cancel
                    </button>
                  </div>
                ) : action.state === 'done' ? (
                  <span style={{ color: 'var(--lf-viridian, #16a34a)', fontWeight: 600 }}>Done ✓</span>
                ) : action.state === 'cancelled' ? (
                  <span style={{ color: 'var(--lf-ink-3)' }}>Cancelled</span>
                ) : (
                  <span style={{ color: 'var(--lf-vermillion, #b3261e)' }}>{action.detail}</span>
                )}
              </div>
            ))}
            {msg.error && (
              <div className="lf-ai-error">
                <span>{msg.error}</span>
                <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={retry}>
                  Retry
                </button>
              </div>
            )}
          </div>
        ))}
        {status !== null && <div className="lf-ai-status">{status}</div>}
      </div>

      <div className="lf-ai-foot">
        <textarea
          ref={inputRef}
          className="lf-textarea"
          rows={2}
          maxLength={4000}
          value={draft}
          placeholder="Ask about your pipeline…"
          aria-label="Message Manath AI"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <button
          type="button"
          className="lf-btn"
          disabled={streaming || !draft.trim()}
          onClick={() => send(draft)}
          aria-label="Send message"
        >
          Send
        </button>
      </div>
    </div>
  );
}
