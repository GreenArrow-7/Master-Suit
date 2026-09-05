import { useId } from 'react';

/**
 * The official YH mark, as vector.
 *
 * Traced from the supplied artwork: the Y's right arm sweeps into the H's
 * crossbar, the H's left stem is split above and below that sweep, and the
 * right stem is a tall slab with a raked top. One component rather than a copy
 * of the same SVG in the sidebar, the auth shell, the platform console and the
 * app bar — when the design team supplies path data, it is replaced once.
 *
 * Drawn inline so the gradient can be the brand's own: cyan at the top-left of
 * the Y into deep blue at the foot of the right stem, which is what the
 * artwork does. No plate behind it — the glyph is the mark. The favicon at
 * app/icon.svg is the one standalone copy, and the only place these paths are
 * repeated: a file served to the browser as an icon cannot import a component.
 *
 * ponytail: hand-traced polygons, not the studio's Béziers. Swap the four
 * <path> elements for the official path data and nothing else needs to change.
 */
export default function YouhanMark({
  size = 34,
  className,
  title,
}: {
  size?: number;
  className?: string;
  /** Pass only when the mark is the sole label for a control. */
  title?: string;
}) {
  // Colons are legal in an id but not in a url(#…) fragment without escaping.
  const gradientId = `yh-mark-${useId().replace(/:/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="-40 -90 1440 1340"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        {/*
         * A unique id per instance, not a fixed one. Two marks render on the
         * login page, and on a phone the first — inside the hidden story panel
         * — is `display: none`. A gradient defined in a non-rendered subtree is
         * not painted, and with a shared id the visible mark resolved to that
         * one and drew nothing. `useId` is stable across server and client.
         */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1ce8ff" />
          <stop offset="45%" stopColor="#0a6bff" />
          <stop offset="100%" stopColor="#0b1f9e" />
        </linearGradient>
      </defs>
      <g fill={`url(#${gradientId})`}>
        {/* The Y, sweeping into the crossbar. */}
        <path d="M30 90 L240 90 L640 548 C680 585 720 570 760 570 L1010 570 L1010 740 L760 740 C640 740 570 705 510 636 Z" />
        {/* Left stem, above the sweep. */}
        <path d="M510 100 L735 100 L735 545 L510 320 Z" />
        {/* Left stem, below the sweep. */}
        <path d="M510 672 L735 758 L735 915 L510 1090 Z" />
        {/* Right stem. */}
        <path d="M1010 235 L1290 35 L1290 1085 L1010 1085 Z" />
      </g>
    </svg>
  );
}
