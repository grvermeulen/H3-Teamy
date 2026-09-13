import { ArenaModePage } from "@/components/cityArena/ArenaModePage";

/** A QR link keeps its room code across login and opens input-only play. */
export default function ArenaControllerPage(): React.JSX.Element {
  return <ArenaModePage defaultRole="controller" />;
}
