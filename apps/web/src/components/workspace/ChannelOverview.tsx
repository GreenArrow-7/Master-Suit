import Link from 'next/link';
import type { ChannelCard } from '@/services/integrations/channelState';

/**
 * The channel-first face of Settings → Integrations (§2, §7).
 *
 * A server component: every value it renders is already resolved, and none of it
 * is interactive, so shipping it as a client bundle would buy nothing.
 *
 * It sits above the vendor credential board rather than replacing it. The board
 * answers "what do I paste where"; this answers "is my WhatsApp working", which
 * is the question an administrator actually arrives with. Two views of the same
 * `IntegrationConnection` rows, one destination in the navigation (§69).
 */

const MODE_COPY: Record<ChannelCard['mode'], { label: string; note: string }> = {
  // Not "connected to the provider": Website and Notifications are first-party
  // and have no provider to connect to, which QA caught on the rendered page.
  LIVE: { label: 'Live', note: 'Active in this workspace.' },
  SIMULATED: { label: 'Simulated', note: 'Messages are simulated in this environment.' },
  NOT_CONFIGURED: { label: 'Not configured', note: 'Not connected yet.' },
};

export default function ChannelOverview({ cards }: { cards: ChannelCard[] }) {
  const ready = cards.filter((card) => card.ready).length;

  return (
    <section className="lf-page-stack" aria-labelledby="channels-heading">
      <div className="lf-channels__intro">
        <h2 className="lf-channels__title" id="channels-heading">
          Channels
        </h2>
        <p className="lf-channels__blurb">
          Connect the channels your team uses to capture leads and manage customer conversations.
        </p>
      </div>

      {/* §61: what is left to do, before the cards rather than buried under them. */}
      <div className="lf-setup" role="status">
        <p className="lf-setup__count">
          <strong>
            {ready} of {cards.length}
          </strong>{' '}
          channels ready
        </p>
        <ol className="lf-setup__list">
          {cards.map((card) => (
            <li className="lf-setup__item" key={card.key} data-ready={card.ready ? 'true' : 'false'}>
              {/* A mark and a word, never the mark alone — §73. */}
              <span aria-hidden="true">{card.ready ? '✓' : '•'}</span>
              <span>{card.title}</span>
              <span className="lf-setup__state">{card.ready ? 'Ready' : 'Setup required'}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="lf-channels">
        {cards.map((card) => (
          <article className="lf-channel" key={card.key} data-mode={card.mode} data-health={card.health}>
            <header className="lf-channel__head">
              <h3 className="lf-channel__name">{card.title}</h3>
              <span className="lf-channel__mode" data-mode={card.mode}>
                {MODE_COPY[card.mode].label}
              </span>
            </header>

            <p className="lf-channel__blurb">{card.blurb}</p>
            <p className="lf-channel__mode-note">{MODE_COPY[card.mode].note}</p>

            <dl className="lf-channel__facts">
              {card.facts.map((fact) => (
                <div className="lf-channel__fact" key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>

            {/* §13: a connection that has stopped working must say so and say
                what to do, not fail quietly. */}
            {card.attention && (
              <p className="lf-channel__attention" role="note">
                {card.attention}
              </p>
            )}

            <Link className="lf-btn lf-btn--secondary lf-btn--sm lf-channel__manage" href={card.href}>
              Manage {card.title}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
