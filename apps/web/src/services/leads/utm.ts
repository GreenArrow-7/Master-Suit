/**
 * Marketing attribution off the referring URL (§20).
 *
 * `FormSubmission.utm` has existed as a column since the model was written and
 * nothing ever populated it. The referrer is the landing page the visitor
 * submitted from, so its query string carries whatever the campaign put there.
 *
 * Only the five standard utm_* keys are kept. Storing the whole query string
 * would sweep up session ids, click ids and email addresses that campaigns
 * routinely append to links, none of which anybody asked to collect.
 *
 * Lives here rather than in the route because Next rejects named exports it does
 * not recognise from a route file, and this needs to be testable on its own.
 */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export function utmFrom(referer: string | null | undefined): Record<string, string> {
  if (!referer) return {};
  try {
    const params = new URL(referer).searchParams;
    return Object.fromEntries(
      UTM_KEYS.map((key) => [key, params.get(key)?.slice(0, 200)]).filter(
        (entry): entry is [string, string] => Boolean(entry[1]),
      ),
    );
  } catch {
    // A malformed Referer header is the visitor's browser talking, not an error
    // worth failing an enquiry over.
    return {};
  }
}
