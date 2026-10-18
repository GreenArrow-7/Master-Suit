/**
 * The workspace's language (NFR-09), set under Administration → Company profile
 * and kept as `OrganizationSetting.defaultLocale`. Arabic lays the workspace out
 * right to left; the words stay English until the interface is translated.
 */
export const WORKSPACE_LOCALES = [
  { value: 'en-AE', label: 'English' },
  { value: 'ar-AE', label: 'Arabic (right to left; text in English for now)' },
] as const;

export type WorkspaceLocale = (typeof WORKSPACE_LOCALES)[number]['value'];

/** Right to left for the scripts that read that way. */
export const textDirection = (locale: string | null | undefined): 'rtl' | 'ltr' =>
  /^(ar|he|fa|ur)\b/i.test(locale ?? '') ? 'rtl' : 'ltr';
