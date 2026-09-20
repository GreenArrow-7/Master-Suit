import { legalFacts, missingLegalFacts } from '@/lib/legal/facts';

export const metadata = { title: 'Privacy Policy · YOUHAN ONE' };

/** Public, unauthenticated. Refuses to render with a placeholder in it. */
export default function PrivacyPage() {
  if (missingLegalFacts().length > 0) {
    return (
      <main className="lf-public">
        <h1>Privacy Policy</h1>
        <p>This page is being finalised and is not yet published.</p>
      </main>
    );
  }
  const f = legalFacts;
  return (
    <main className="lf-public lf-privacy-page">
      <div className="lf-privacy-header">
        <h1>Privacy Policy</h1>
        <p className="lf-subtitle">How YOUHAN ONE handles your information</p>
        <p className="lf-updated">Effective date: {f.lastUpdated}</p>
      </div>

      <section className="lf-privacy-summary">
        <h2>At a glance</h2>
        <ul className="lf-summary-list">
          <li>YOUHAN ONE is business software for managing sales, customers and teams</li>
          <li>Your organisation, not YOUHAN, owns the data it records</li>
          <li>No advertising, tracking or unnecessary data collection</li>
          <li>
            Data stays with your infrastructure provider (<a href="#hosting">Hetzner</a>)
          </li>
          <li>
            You can delete your account anytime; your personal data is removed within {f.deletionTargetHours} hours
          </li>
          <li>
            Questions? Contact <a href={`mailto:${f.privacyEmail}`}>{f.privacyEmail}</a>
          </li>
        </ul>
      </section>

      <nav className="lf-privacy-nav">
        <h3>On this page</h3>
        <ul>
          <li>
            <a href="#who-we-are">Who we are</a>
          </li>
          <li>
            <a href="#how-accounts-work">How accounts work</a>
          </li>
          <li>
            <a href="#information-we-collect">Information we collect</a>
          </li>
          <li>
            <a href="#camera-location-face">Camera, location and face</a>
          </li>
          <li>
            <a href="#ai-and-calls">AI and call features</a>
          </li>
          <li>
            <a href="#third-parties">Third-party services</a>
          </li>
          <li>
            <a href="#storage-retention">Storage and retention</a>
          </li>
          <li>
            <a href="#deleting-your-account">Deleting your account</a>
          </li>
          <li>
            <a href="#security">Security</a>
          </li>
          <li>
            <a href="#your-rights">Your rights and contact</a>
          </li>
        </ul>
      </nav>

      <section id="who-we-are">
        <h2>Who we are</h2>
        <p>
          YOUHAN ONE is business software provided by <strong>{f.legalEntity}</strong>, based in{' '}
          <strong>
            {f.address}, {f.country}
          </strong>
          . Organisations use it to manage sales pipelines, customer relationships, team attendance, and payroll.
        </p>
        <p>
          <strong>Important:</strong> Your organisation owns and controls the information in YOUHAN ONE. We provide the
          platform; your organisation decides what is recorded and how it is used.
        </p>
      </section>

      <section id="how-accounts-work">
        <h2>How accounts work</h2>
        <p>
          There is no public sign-up for YOUHAN ONE. An administrator in your organisation invites you, and your account
          is linked to that workspace.
        </p>
        <p>
          Your organisation&rsquo;s administrator can access and manage your account, reset your password, and view your
          activity, subject to their role and permissions.
        </p>
      </section>

      <section id="information-we-collect">
        <h2>Information we collect</h2>
        <p>
          All information collected is used only to provide the service. We do not use it for advertising or tracking.
        </p>

        <h3>Your identity and access</h3>
        <ul>
          <li>Your name, email address and phone number — to sign you in and show who made changes</li>
          <li>A profile photo if you upload one</li>
          <li>IP address and browser details when you sign in — for security and audit logs</li>
          <li>Two-factor authentication setup and sessions</li>
        </ul>

        <h3>Business records you create</h3>
        <ul>
          <li>Leads, customers and contacts — names, phone numbers, emails, addresses and notes you record</li>
          <li>Sales pipeline activities — calls, meetings, offers and follow-ups</li>
          <li>Financial information — collections, receipts, deals and commissions</li>
          <li>Documents and attachments — photos, agreements, identity documents and receipts</li>
        </ul>

        <h3>Employment and payroll</h3>
        <ul>
          <li>Your job title, role and permissions</li>
          <li>Payroll information — salary, bank details and tax identifiers (these are encrypted)</li>
          <li>Attendance and check-in records</li>
          <li>Performance reviews and approvals assigned to you</li>
        </ul>

        <h3>Usage and audit records</h3>
        <ul>
          <li>What you opened, created, edited and deleted</li>
          <li>When you signed in and out</li>
          <li>API keys and integrations you set up</li>
        </ul>
      </section>

      <section id="camera-location-face">
        <h2>Camera, location and face verification</h2>

        <h3>When we ask for these permissions</h3>
        <p>YOUHAN ONE asks permission to use your device&rsquo;s camera, location or both when you:</p>
        <ul>
          <li>Check in for attendance</li>
          <li>Record a site visit</li>
          <li>Use face verification to enrol or verify your identity (optional)</li>
        </ul>

        <h3>You are in control</h3>
        <p>
          You decide on each screen whether to grant permission. You can refuse and still use the feature — for example,
          you can check in without taking a photo, or record a site visit without sharing your location. You can
          withdraw permission at any time in your device&rsquo;s settings.
        </p>

        <h3>What we store</h3>
        <ul>
          <li>
            <strong>Check-in photos:</strong> Attached to your check-in record. Deleted when you delete that record.
          </li>
          <li>
            <strong>Location:</strong> Recorded at the moment you check in. Stored with that check-in record. Your
            organisation&rsquo;s administrator can see your location history.
          </li>
          <li>
            <strong>Face verification:</strong> A mathematical template (not a photo), stored in an encrypted field. You
            can delete your face template anytime on the Security screen, and it is removed immediately.
          </li>
        </ul>
      </section>

      <section id="ai-and-calls">
        <h2>AI features and call recordings</h2>

        <h3>AI-assisted calls</h3>
        <p>
          If your organisation enables AI assistance during calls, YOUHAN ONE can send call audio to Google Gemini for
          transcription and drafting assistance. Your organisation chooses whether this feature is on or off.
        </p>
        <p>
          <strong>Currently enabled at launch:</strong> {f.geminiEnabledAtLaunch}
        </p>

        <h3>Call recordings and transcripts</h3>
        <p>
          Calls are only recorded if your organisation has enabled recording and you have given consent on the call
          screen. Recordings are kept according to the retention date your organisation sets on each recording.
        </p>
        <p>
          If you delete your account, call recordings are not automatically deleted — they stay with your
          organisation&rsquo;s records at the retention date they set.
        </p>

        <h3>How data is sent</h3>
        <p>When AI features are enabled, your organisation is responsible for:</p>
        <ul>
          <li>Telling you that call data may be sent to external AI providers</li>
          <li>Getting any necessary consent</li>
          <li>Complying with data protection laws</li>
        </ul>
        <p>All data is encrypted in transit and sent directly to the provider, never stored by YOUHAN itself.</p>
      </section>

      <section id="third-parties">
        <h2>Third-party services</h2>
        <p>
          YOUHAN ONE does not use advertising, analytics or tracking tools. Data only leaves your system when your
          organisation configures an integration with a service provider.
        </p>
        <p>Supported integrations include:</p>
        <ul>
          <li>Email relay services (for sending invoices and notifications)</li>
          <li>Meta WhatsApp Business (if your organisation enables it)</li>
          <li>Google Calendar (if you connect it)</li>
          <li>Telephony providers (if your organisation uses call features)</li>
          <li>Google Gemini (if your organisation enables AI features)</li>
        </ul>
        <p>
          Your organisation chooses which services to connect. If a service is not set up, your data does not go there.
        </p>
        <p>
          <strong id="hosting">Hosting and storage:</strong> All infrastructure is operated by{' '}
          <strong>{f.hostingProvider}</strong>. Files are scanned for viruses and encrypted at rest.
        </p>
      </section>

      <section id="storage-retention">
        <h2>Storage and retention</h2>

        <h3>Backups</h3>
        <p>
          Encrypted backups are kept for {f.backupRetentionDays} days. Backups cannot be edited selectively — if data is
          restored from a backup, all changes since that backup are lost.
        </p>

        <h3>Business records</h3>
        <p>
          Leads, customers, financial records and documents you create stay as long as your organisation keeps them. If
          you delete your account, your records stay with your organisation (so they can keep the customer history), but
          your name is removed from new records and your identifying information is deleted.
        </p>

        <h3>Payroll and employment records</h3>
        <p>
          Your salary, bank details, payroll records and employment history are kept according to your
          organisation&rsquo;s policy and local law. If you delete your account:
        </p>
        <ul>
          <li>Your bank and payroll identifiers are removed immediately</li>
          <li>Your identity documents are removed after 15 days</li>
          <li>Your audit trail (who changed what) is kept with the last update showing your user ID only</li>
        </ul>

        <h3>Call recordings</h3>
        <p>
          Recordings are kept until the retention date your organisation sets on each recording. There is no automatic
          deletion when you delete your account.
        </p>
      </section>

      <section id="deleting-your-account">
        <h2>Deleting your account</h2>

        <h3>How to request deletion</h3>
        <p>
          In YOUHAN ONE, go to <strong>Profile → Security</strong> and select <em>Delete my account</em>. You&rsquo;ll
          confirm with your password (and authenticator code if you&rsquo;ve set one up).
        </p>

        <h3>What happens</h3>
        <p>When your account is deleted:</p>
        <ul>
          <li>
            <strong>Removed:</strong> Your sign-in, password, two-factor setup, sessions, face templates, personal
            contact details, and API keys
          </li>
          <li>
            <strong>Kept:</strong> Leads, calls, receipts and approvals you created (with your name attached, so your
            organisation keeps the work history)
          </li>
          <li>
            <strong>Also kept:</strong> Audit logs (showing who changed what), employment records, and payroll records
            (required by law)
          </li>
        </ul>

        <h3>Processing time</h3>
        <p>
          Eligible requests are processed within {f.deletionTargetHours} hours as an operational target. If you are your
          organisation&rsquo;s owner or the last administrator, you&rsquo;ll be asked to transfer that responsibility
          first.
        </p>

        <h3>What you&rsquo;ll receive</h3>
        <p>
          You&rsquo;ll receive a record of what was deleted and what was kept, and why. If you need more details, you
          can contact {f.privacyEmail}.
        </p>
      </section>

      <section id="security">
        <h2>Security</h2>
        <p>YOUHAN ONE uses industry-standard security practices:</p>
        <ul>
          <li>Passwords are hashed and cannot be read by anyone, including administrators</li>
          <li>Payroll and identity information is encrypted in the database</li>
          <li>All data in transit is encrypted (HTTPS/TLS)</li>
          <li>Two-factor authentication is available and recommended</li>
          <li>Access is controlled by role and permissions set by your organisation&rsquo;s administrator</li>
        </ul>
        <p>
          No system is completely secure. If you discover a security issue, please contact {f.privacyEmail} instead of
          publishing it publicly.
        </p>
      </section>

      <section id="your-rights">
        <h2>Your rights and contact</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Request access to your personal data</li>
          <li>Ask to correct inaccurate information</li>
          <li>
            Request deletion (see <a href="#deleting-your-account">Deleting your account</a>)
          </li>
          <li>File a complaint about how your data is handled</li>
        </ul>
        <p>
          To exercise these rights or if you have privacy concerns, contact{' '}
          <a href={`mailto:${f.privacyEmail}`}>{f.privacyEmail}</a>. Support is available by email and monitored until
          21:00 Gulf Standard Time (UTC+4).
        </p>
        <p>
          Your organisation&rsquo;s administrator may also be able to help with data access and correction requests.
        </p>

        <h3>Changes to this policy</h3>
        <p>
          We may update this policy if our practices change. We&rsquo;ll notify you of significant changes via email or
          by posting a notice in the app. Your continued use of YOUHAN ONE means you accept the updated policy.
        </p>

        <p className="lf-last-updated">Last updated: {f.lastUpdated}</p>
      </section>
    </main>
  );
}
