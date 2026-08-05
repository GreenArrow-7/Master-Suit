/**
 * Product name for the application shell.
 *
 * Configurable rather than hardcoded: the platform is sold to multiple
 * companies and the working name is expected to change before launch. Must be
 * NEXT_PUBLIC_ so the client components in the shell can read it too.
 */
export const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Master Suite';
