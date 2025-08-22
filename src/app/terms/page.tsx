export default function TermsPage() {
  return (
    <main>
      <div className="container">
        <h1>Terms of Service</h1>
        <p className="muted">Last updated: {new Date().toLocaleDateString()}</p>
        <div className="card" style={{ marginTop: 12 }}>
          <p>
            This service is provided on a best-effort basis for De Rijn H3 team coordination.
            Content is community moderated by team administrators. By using this site you
            agree to use it respectfully and only for team-related purposes.
          </p>
          <p>
            We may update these terms over time. Continued use of the site constitutes acceptance
            of any changes. If you do not agree, please stop using the service.
          </p>
        </div>
      </div>
    </main>
  );
}


