export default function Loading() {
  return (
    <main>
      <div className="container">
        <h1>Admin</h1>
        <div
          className="card skeleton"
          style={{ height: 56, marginBottom: 12 }}
        />
        <div className="list" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card skeleton" style={{ height: 48 }} />
          ))}
        </div>
      </div>
    </main>
  );
}
