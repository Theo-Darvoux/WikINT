export default function PrivacyPage() {
  return (
    <div className="w-full mx-auto max-w-3xl space-y-8 py-8 px-4">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Data Collection</h2>
        <p className="text-muted-foreground leading-relaxed">
          WikINT collects the minimum data necessary to provide the service.
          This includes your school email address, display name, academic year,
          and any content you voluntarily contribute (materials, comments,
          annotations, contributions).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Data Processing</h2>
        <p className="text-muted-foreground leading-relaxed">
          Your data is processed solely to operate the platform: authenticating
          your identity, displaying your contributions, sending notifications,
          and enabling collaboration between users. We do not sell, share, or
          transfer your data to third parties.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Content Ownership & License</h2>
        <p className="text-muted-foreground leading-relaxed">
          By uploading materials to WikINT, you grant WikINT and its creators an
          irrevocable, perpetual, royalty-free license to host, display,
          distribute, and make available the contributed content for the benefit
          of the community. Uploaded materials become the property of WikINT and
          its creators.
        </p>
        <p className="text-muted-foreground leading-relaxed">
          This means that contributed materials (documents, files, media) will
          remain on the platform even if you delete your account. Your personal
          information (name, email) will be disassociated from the content upon
          account deletion, but the content itself will be retained to preserve
          the knowledge base for all users.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Data Retention</h2>
        <p className="text-muted-foreground leading-relaxed">
          Your account data is retained for as long as your account is active.
          If you delete your account, your personal data (name, email, bio,
          avatar) is anonymized immediately and permanently removed. Contributed
          content (materials, annotations, comments) is retained in anonymized
          form as per the content license above.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Your Rights</h2>
        <p className="text-muted-foreground leading-relaxed">
          Under GDPR, you have the right to access, rectify, and delete your
          personal data. You can export all your data from the Settings page at
          any time. You can delete your account at any time, which will
          anonymize your personal data immediately and permanently. Note that
          the right to erasure applies to personal data only; contributed
          materials are retained under the content license granted upon upload.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Cookies</h2>
        <p className="text-muted-foreground leading-relaxed">
          WikINT uses strictly necessary cookies to keep you logged in and store
          your preferred theme. We do not use third-party tracking cookies or
          analytics services.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Contact</h2>
        <p className="text-muted-foreground leading-relaxed">
          For questions about this privacy policy or your data, contact the
          platform administrators at Telecom SudParis / IMT-BS.
        </p>
      </section>
    </div>
  );
}
