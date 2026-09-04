import { AppBar } from "../../../components/ui";

export default function Loading() {
  return (
    <main>
      <div className="container" aria-busy="true" aria-label="Verslag laden">
        <AppBar title="Wedstrijdverslag" />
        <div className="skeleton" style={{ height: 18, width: "45%" }} />
        <div className="list" style={{ marginTop: 24 }}>
          <div className="skeleton" style={{ height: 18, width: "100%" }} />
          <div className="skeleton" style={{ height: 18, width: "92%" }} />
          <div className="skeleton" style={{ height: 18, width: "96%" }} />
          <div className="skeleton" style={{ height: 18, width: "72%" }} />
        </div>
        <div className="card skeleton" style={{ height: 132, marginTop: 28 }} />
      </div>
    </main>
  );
}
