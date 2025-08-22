export type TeamEvent = {
  id: string;
  uid?: string;
  title: string;
  start: string; // ISO
  end?: string; // ISO
  location?: string;
  description?: string;
};

export type RsvpStatus = "yes" | "no" | "maybe" | null;

export type UserProfile = {
  firstName: string;
  lastName: string;
};

export type EventRsvpList = {
  yes: { id: string; name: string }[];
  no: { id: string; name: string }[];
  maybe: { id: string; name: string }[];
};

export type EventRsvpCounts = { yes: number; no: number; maybe: number };


