export default function Loading() {
  return (
    <main>
      <div className="container">
        <h1>Trainingsopkomst</h1>
        <div className="list" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card skeleton" style={{ height: 56 }} />
          ))}
        </div>
      </div>
    </main>
  );
}
