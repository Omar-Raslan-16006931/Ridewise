import type { Member, Trip } from "./types";

type TripSummary = Pick<Trip, "amount" | "direction" | "trip_mode" | "notes">;

export function isAutoLogged(notes: string | null | undefined): boolean {
  return /auto-logged|via ios shortcut/i.test(notes ?? "");
}

/** Shared wording for ride notifications (in-app toast, server feed, background check, Shortcut reply). */
export function tripNotification(trip: TripSummary, payerName?: string | null): { title: string; body: string } {
  const amount = `EGP ${Number(trip.amount).toFixed(2).replace(/\.00$/, "")}`;
  const parts = [
    amount,
    trip.direction === "campus" ? "to campus" : "to home",
    trip.trip_mode === "solo" ? "solo" : "shared",
    payerName ? `${payerName} paid` : null,
  ].filter(Boolean);
  return {
    title: isAutoLogged(trip.notes) ? "Ride auto-logged" : "New ride added",
    body: parts.join(" · "),
  };
}

export function describeTrip(trip: TripSummary & Pick<Trip, "paid_by">, members: Member[]): { title: string; body: string } {
  return tripNotification(trip, members.find((member) => member.user_id === trip.paid_by)?.display_name);
}
