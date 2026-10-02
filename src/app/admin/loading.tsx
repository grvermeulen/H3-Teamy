import AdminNav from "../../components/AdminNav";

export default function Loading() {
  return (
    <main>
      <div className="container">
        <h1>Admin</h1>
        <AdminNav />
        <div className="skeleton h-16 mb-4" />
        <div className="card skeleton h-14 mb-3" />
        <div className="list" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card skeleton h-12" />
          ))}
        </div>
      </div>
    </main>
  );
}
