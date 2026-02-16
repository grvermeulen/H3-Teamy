export default function Loading() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "50vh",
        color: "#888",
      }}
    >
      <div className="animate-pulse">Loading...</div>
    </div>
  );
}
