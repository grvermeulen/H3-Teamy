import { AppBar } from "../../../components/ui";

export default function Loading() {
  return (
    <main>
      <div className="container" aria-busy="true" aria-label="Feedback laden">
        <AppBar title="Feedback" fallbackHref="/admin" />
        <div className="skeleton" style={{ height: 16, width: "35%" }} />
        <div className="row" style={{ marginTop: 20 }}>
          <div className="skeleton" style={{ height: 44, width: 120 }} />
          <div className="skeleton" style={{ height: 44, width: 140 }} />
        </div>
        <div className="list">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="card skeleton" style={{ height: 96 }} />
          ))}
        </div>
      </div>
    </main>
  );
}
