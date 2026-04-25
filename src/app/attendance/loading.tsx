export default function Loading() {
  return (
    <main>
      <div className="container">
        <h1>Opkomst</h1>
        <div
          className="card skeleton"
          style={{ height: 72, marginBottom: 12 }}
        />
        <div className="list" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card skeleton" style={{ height: 56 }} />
          ))}
        </div>
      </div>
    </main>
  );
}
