import {
  ArenaRoomTicketSchema,
  ARENA_PROTOCOL_VERSION,
  type ArenaRoomCommand,
  type ArenaRoomTicket,
} from "./roomProtocol";

/** A user-visible refusal from the authenticated room API. */
export class ArenaRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason?: string,
  ) {
    super(message);
    this.name = "ArenaRequestError";
  }
}

/** The injectable room API boundary used by the UI and transport integration tests. */
export type ArenaRoomClient = (
  command: ArenaRoomCommand,
  keepalive?: boolean,
) => Promise<ArenaRoomTicket | null>;

/** Sends a same-origin membership command and validates the server's authority response. */
export async function sendArenaRoomCommand(
  command: ArenaRoomCommand,
  keepalive = false,
  display = false,
): Promise<ArenaRoomTicket | null> {
  const response = await fetch(
    display ? "/api/arena/display-token" : "/api/arena/session",
    {
      method:
        display && command.action !== "create" && command.action !== "join"
          ? "PATCH"
          : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Arena-Protocol": String(ARENA_PROTOCOL_VERSION),
      },
      body: JSON.stringify(command),
      credentials: "same-origin",
      cache: "no-store",
      keepalive,
    },
  );
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = body as { error?: unknown; reason?: unknown };
    throw new ArenaRequestError(
      typeof error.error === "string"
        ? error.error
        : "Het potje is even niet beschikbaar",
      response.status,
      typeof error.reason === "string" ? error.reason : undefined,
    );
  }
  const ticket = (body as { ticket: unknown }).ticket;
  return ticket === null ? null : ArenaRoomTicketSchema.parse(ticket);
}

/** Uses anonymous screen credentials rather than the signed-in player's session. */
export const sendArenaDisplayCommand: ArenaRoomClient = (command, keepalive) =>
  sendArenaRoomCommand(command, keepalive, true);
