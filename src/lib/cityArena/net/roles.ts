import type { ArenaRole, ArenaRoomTicket } from "./roomProtocol";

/** Higher priority wins; controllers never run a simulation. */
export function arenaHostPriority(member: {
  role?: string;
  device?: string;
}): number {
  if (member.role === "controller") return 0;
  if (member.role === "display" || member.role === "hybrid") return 3;
  return member.device === "mobile" ? 1 : 2;
}

/** Mode belonging to the ticket's own member; older tickets denote normal players. */
export function ticketRole(ticket: ArenaRoomTicket): ArenaRole {
  return (
    ticket.members.find((member) => member.clientId === ticket.memberId)
      ?.role ?? "player"
  );
}

/** A display never consumes a player slot or appears in a result. */
export function arenaPlayerMembers(
  ticket: ArenaRoomTicket,
): ArenaRoomTicket["members"] {
  return ticket.members.filter((member) => member.role !== "display");
}
