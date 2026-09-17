import { legalFacts, missingLegalFacts } from '@/lib/legal/facts';

export const metadata = { title: 'Support · YOUHAN ONE' };

/** Public, unauthenticated. Refuses to render with a placeholder in it. */
export default function SupportPage() {
  if (missingLegalFacts().length > 0) {
    return (
      <main className="lf-public">
        <h1>Support</h1>
        <p>This page is being finalised and is not yet published.</p>
      </main>
    );
  }
  const f = legalFacts;
  return (
    <main className="lf-public">
      <h1>Support</h1>
      <ul>
        <li>
          <strong>Your account</strong> (password, authenticator, access): contact your organisation&rsquo;s
          administrator first — they manage your account.
        </li>
        <li>
          <strong>Report a problem with the app:</strong> {f.supportEmail} ({f.supportHours}).
        </li>
        <li>
          <strong>Privacy requests:</strong> {f.privacyEmail}.
        </li>
        <li>
          <strong>Delete your account:</strong> in the app, Profile → Security → <em>Delete my account</em>.
        </li>
      </ul>
    </main>
  );
}
