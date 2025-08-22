export default function PrivacyPage() {
  return (
    <main>
      <div className="container">
        <h1>Privacy Policy</h1>
        <p className="muted">Last updated: {new Date().toLocaleDateString()}</p>
        <div className="card" style={{ marginTop: 12 }}>
          <p>
            This site displays the De Rijn H3 waterpolo schedule and allows team members to RSVP.
            We store only what is needed to operate the app: a device identifier, your name (if
            you choose to save it), and your RSVP responses. Data is stored in our database and
            is not shared with third parties.
          </p>
          <p>
            If you sign in with Google, we receive your basic profile (name, email) to show who
            you are to teammates and to keep RSVPs linked to your account. You can sign out at
            any time.
          </p>
          <p>
            To request data deletion or export, contact the team administrator.
          </p>
        </div>
      </div>
    </main>
  );
}


