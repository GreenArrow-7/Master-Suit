import { legalFacts, missingLegalFacts } from '@/lib/legal/facts';

export const metadata = { title: 'Privacy policy · YOUHAN ONE' };

/** Public, unauthenticated. Refuses to render with a placeholder in it. */
export default function PrivacyPage() {
  if (missingLegalFacts().length > 0) {
    return (
      <main className="lf-public">
        <h1>Privacy policy</h1>
        <p>This page is being finalised and is not yet published.</p>
      </main>
    );
  }
  const f = legalFacts;
  return (
    <main className="lf-public">
      <h1>Privacy policy</h1>
      <p>
        <strong>Who we are.</strong> YOUHAN ONE is business software provided by {f.legalEntity}, {f.address},{' '}
        {f.country}. Organisations (&ldquo;workspaces&rdquo;) use it to manage sales, customers, staff and payroll.
        Your organisation, not YOUHAN, decides what is recorded in it.
      </p>
      <p>
        <strong>Accounts.</strong> There is no public sign-up. An administrator in your organisation invites you, and
        your account is linked to that workspace.
      </p>
      <h2>What the app collects, and why</h2>
      <p>All of the following are used only to provide the service; none is used for advertising or tracking.</p>
      <ul>
        <li>Your identity and contact details — name, email, phone, photo — to sign you in and show who did what.</li>
        <li>Contact details of the people you record — leads, customers, property owners — entered by you or colleagues.</li>
        <li>Precise location — only when you check in for attendance or record a site visit, at that moment.</li>
        <li>
          Face templates — only if you give consent on the Security screen; a mathematical template, not a photograph.
          You can withdraw consent at any time and the templates are deleted immediately.
        </li>
        <li>Financial and payroll information recorded by your organisation.</li>
        <li>Documents and photos you upload, including identity documents held by your HR team.</li>
        <li>Call recordings and transcripts — only where your organisation has enabled recording and consent is recorded.</li>
        <li>Usage and audit records — what was opened and changed, with your user id, IP address and browser.</li>
        <li>Diagnostics — server request and error logs keyed to a request id.</li>
      </ul>
      <h2>Third parties</h2>
      <p>
        No analytics, advertising or tracking SDK is in the app. Data leaves the service only to providers your
        organisation configures: an email relay, Meta WhatsApp Business, Google Calendar, a telephony provider, and —
        where enabled — Google Gemini, which receives call audio for transcription and text for analysis and drafting
        assistance. Providers enabled at launch: {f.geminiEnabledAtLaunch}. Files are virus-scanned and stored in
        infrastructure operated by {f.hostingProvider}.
      </p>
      <h2>Retention and backups</h2>
      <p>
        Encrypted backups are kept for {f.backupRetentionDays} days and cannot be edited selectively. Retention of
        employment records, documents and audit records follows your organisation&rsquo;s policy.
      </p>
      <h2>Deleting your account</h2>
      <p>
        Profile → Security → <em>Delete my account</em>. You confirm with your password (and authenticator code if
        enabled). Your sign-in, password, two-factor setup, sessions, face templates, personal contact details and API
        keys are removed and your membership of every workspace ends. Records you created for your organisation —
        leads, calls, receipts, approvals — stay with the organisation with your name against them, as do the audit
        trail and your employment record. The completed request records exactly what was kept and why. Eligible
        requests are processed within {f.deletionTargetHours} hours as an operational target; if you are your
        organisation&rsquo;s owner or last administrator you are asked to hand that over first.
      </p>
      <h2>Your rights and contact</h2>
      <p>
        To access, correct or delete your data, or to complain, contact {f.privacyEmail}. Last updated {f.lastUpdated}.
      </p>
    </main>
  );
}
