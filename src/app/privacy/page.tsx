export default function PrivacyPage() {
  return (
    <main>
      <div className="container">
        <h1>Privacy Policy</h1>
        <p className="muted">Last updated: {new Date().toLocaleDateString()}</p>
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Overview</h3>
          <p>
            This website (&quot;App&quot;) helps De Rijn H3 organize matches and attendance. This
            policy explains what data we collect, how we use it, and your choices.
          </p>

          <h3>Data We Collect</h3>
          <ul>
            <li>Name you provide (first and last name).</li>
            <li>Anonymous device identifier (cookie `anon_id`).</li>
            <li>RSVP responses per match (Yes/Maybe/No).</li>
            <li>
              If you sign in with Google: basic profile from Google (name and email) to identify
              you to teammates and link RSVPs to your account.
            </li>
          </ul>

          <h3>How We Use Data</h3>
          <ul>
            <li>Show upcoming matches and team availability.</li>
            <li>Link your name/account to your RSVP responses.</li>
            <li>Maintain basic team statistics (counts only).</li>
          </ul>

          <h3>Storage & Security</h3>
          <ul>
            <li>Data is stored in our database (Postgres) managed by our hosting provider.</li>
            <li>Transport is encrypted via HTTPS; credentials and keys are stored as environment variables.</li>
          </ul>

          <h3>Sharing</h3>
          <p>
            We do not sell data. We do not share personal data with third parties other than our
            infrastructure providers to run the App.
          </p>

          <h3>Retention & Deletion</h3>
          <p>
            We retain RSVP history for the duration of the season and then archive or delete it.
            You can request correction or deletion at any time.
          </p>

          <h3>Your Choices</h3>
          <ul>
            <li>Use the App without Google sign-in (only a device identifier is set).</li>
            <li>Sign in with Google to sync identity across devices.</li>
            <li>Request data access or deletion at: <a href="mailto:grvermeulen@gmail.com">grvermeulen@gmail.com</a>.</li>
          </ul>

          <h3>Changes</h3>
          <p>We may update this policy and will reflect changes on this page with a new date.</p>
        </div>
      </div>
    </main>
  );
}


