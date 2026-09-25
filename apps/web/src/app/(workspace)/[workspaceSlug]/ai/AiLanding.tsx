'use client';

import { useEffect } from 'react';
import { ASSISTANT_NAME } from '@/lib/branding';

/**
 * The event AssistantWidget listens for. Duplicated here rather than exported
 * from the widget so this page does not pull the whole panel into its bundle.
 */
const OPEN_EVENT = 'lf:open-ai';
const open = () => window.dispatchEvent(new CustomEvent(OPEN_EVENT));

/**
 * The rail's ONE AI item lands here. The panel is the product; this page opens
 * it on arrival and stays underneath as the place to come back to — a
 * destination with a URL, not a bubble.
 */
export default function AiLanding({ prompts }: { prompts: string[] }) {
  useEffect(() => {
    open();
  }, []);
  return (
    <section className="lf-ai-landing">
      <p className="lf-ai-landing__lede">
        Ask about your pipeline, your follow-ups or your latest call. Answers come from your own workspace data, and any
        change {ASSISTANT_NAME} proposes waits for your confirmation.
      </p>
      <button type="button" className="lf-btn" onClick={open}>
        Ask {ASSISTANT_NAME}
      </button>
      <ul className="lf-ai-landing__prompts">
        {prompts.map((p) => (
          <li key={p}>
            <button type="button" onClick={open}>
              {p}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
