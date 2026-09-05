/**
 * Product name for the application shell.
 *
 * Configurable rather than hardcoded: the platform is sold to multiple
 * companies and the name has changed once already. Must be NEXT_PUBLIC_ so the
 * client components in the shell can read it too.
 */
export const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'YOUHAN ONE';

/**
 * The short form, for places the full lockup will not fit: the collapsed
 * sidebar, a phone app bar, a browser tab on a long page title.
 *
 * The last word of the product name, because that is the part that identifies
 * the product rather than the vendor: "YOUHAN ONE" → "ONE". A white-label
 * deployment whose name does not work that way sets
 * NEXT_PUBLIC_PRODUCT_SHORT_NAME explicitly.
 */
export const PRODUCT_SHORT_NAME =
  process.env.NEXT_PUBLIC_PRODUCT_SHORT_NAME || PRODUCT_NAME.split(' ').slice(-1)[0] || PRODUCT_NAME;

/** The parent company. Used sparingly — the auth screens and the About panel. */
export const COMPANY_NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || 'YOUHAN';

/** Product positioning line. One place, so it cannot drift between screens. */
export const PRODUCT_TAGLINE = 'Your business. Working as one.';

/** The one-sentence description, for metadata, the manifest and the auth pane. */
export const PRODUCT_DESCRIPTION = 'Sales, people, operations and intelligence connected in one platform.';

/**
 * The copilot's name.
 *
 * It was "Manath AI" — the name of the first customer's workspace, which had
 * ended up in the product chrome of every tenant. The assistant is part of the
 * product, so it is named after the product.
 */
export const ASSISTANT_NAME = 'ONE AI';
export const ASSISTANT_TAGLINE = 'Business intelligence copilot';
