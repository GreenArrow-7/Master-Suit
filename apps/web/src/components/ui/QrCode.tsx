import { toString as qrToString } from 'qrcode';

/**
 * A QR code, rendered on the server as inline SVG.
 *
 * Server-side and inline for three reasons that all point the same way: the
 * value is known when the page is rendered, an SVG scales to whatever a phone
 * screen decides to be without going soft, and nothing about it needs to reach
 * the browser as JavaScript. A client-side generator would ship a library to
 * every visitor to draw something the server already knows.
 *
 * `dangerouslySetInnerHTML` is how inline SVG is done in React, and the name is
 * doing the work here rather than the risk. The markup comes from `qrcode`'s own
 * serializer, which emits a fixed shape — one `<svg>`, two `<path>` elements of
 * rectangle commands — and the caller's value reaches it as data to encode, not
 * as characters to write. A value cannot break out of the encoder into the
 * markup, which is the property that makes this safe rather than a promise that
 * callers will be careful.
 *
 * `errorCorrectionLevel: 'M'` is the default and stays: a door pass on a phone
 * screen is read at 20cm in good light, not off a wet poster, so spending more
 * of the symbol on redundancy would only make the modules smaller.
 */
export default async function QrCode({
  value,
  size = 200,
  label,
}: {
  value: string;
  /** Rendered width in px. The SVG has no intrinsic size; this is the box. */
  size?: number;
  /** What a screen reader says. A QR with no text alternative is a blank box. */
  label: string;
}) {
  const svg = await qrToString(value, {
    type: 'svg',
    // 1 module of quiet zone rather than the spec's 4: the card around it
    // already provides visual margin, and 4 leaves the symbol looking tiny
    // inside its own padding.
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  });

  return (
    <div
      role="img"
      aria-label={label}
      style={{
        width: size,
        height: size,
        // White stays white whatever the surface behind it is. A QR rendered
        // dark-on-dark by a theme is one that no scanner will read.
        background: '#ffffff',
        padding: 8,
        borderRadius: 'var(--lf-radius-sm)',
        display: 'grid',
        placeItems: 'center',
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
