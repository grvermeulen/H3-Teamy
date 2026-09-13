import type { ArenaRoomTicket } from "./roomProtocol";

/** A deterministic server ticket for isolated transport and component tests. */
export function roomTicket(
  overrides: Partial<ArenaRoomTicket> = {},
): ArenaRoomTicket {
  const memberId = "22222222-2222-4222-8222-222222222222";
  return {
    roomId: "11111111-1111-4111-8111-111111111111",
    roomCode: "ABC234",
    zone: "campus",
    memberId,
    hostClientId: memberId,
    epoch: 1,
    leaseUntil: Date.now() + 12000,
    serverTime: Date.now(),
    members: [{ clientId: memberId, name: "Guido", joinedAt: Date.now() }],
    round: null,
    ...overrides,
  };
}
