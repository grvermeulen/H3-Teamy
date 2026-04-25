export default function Loading() {
  return (
    <main>
      <div className="container">
        <div className="list" aria-busy="true" aria-live="polite">
          <div className="card skeleton" style={{ height: 84 }} />
          <div className="card skeleton" style={{ height: 84 }} />
          <div className="card skeleton" style={{ height: 84 }} />
        </div>
      </div>
    </main>
  );
}
