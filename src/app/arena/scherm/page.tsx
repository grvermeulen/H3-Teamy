import { ArenaModePage } from "@/components/cityArena/ArenaModePage";

/** Public room-scoped TV entry; players authenticate on their own phones. */
export default function ArenaScreenPage(): React.JSX.Element {
  return <ArenaModePage defaultRole="display" />;
}
