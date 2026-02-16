import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "60vh",
        textAlign: "center",
        gap: "1.5rem",
        padding: "1rem",
      }}
    >
      <h1
        style={{ fontSize: "4rem", margin: 0, fontWeight: 800, color: "#333" }}
      >
        404
      </h1>
      <div>
        <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
          Page Not Found
        </h2>
        <p style={{ color: "#666", maxWidth: "400px", margin: "0 auto" }}>
          We could not find the page you were looking for. It might have been
          moved or deleted.
        </p>
      </div>
      <Link
        href="/"
        style={{
          display: "inline-block",
          padding: "10px 20px",
          background: "#111926",
          color: "white",
          textDecoration: "none",
          borderRadius: "6px",
          fontWeight: 500,
        }}
      >
        Return Home
      </Link>
    </div>
  );
}
