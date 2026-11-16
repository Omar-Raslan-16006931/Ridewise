import { isCollegeDay } from "./analytics";
import type { Member, RideGroup, Trip } from "./types";

export const demoGroup: RideGroup = { id: "demo-group", name: "Omar + Khaled", invite_code: "RIDE2026" };
export const demoMembers: Member[] = [
  { user_id: "omar", display_name: "Omar" },
  { user_id: "khaled", display_name: "Khaled" },
];

/** About four months of believable rides ending today, the same on every load. Preview mode only. */
export function buildDemoTrips(now: Date = new Date()): Trip[] {
  let seed = 20260912;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const trips: Trip[] = [];
  const notes = ["Morning lecture", "Traffic was wild", "Lab day", "Quiz at 9", null, null, null, null];
  for (let back = 112; back >= 0; back--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    if (!isCollegeDay(day) || rand() < 0.14) continue;
    const legs: Trip["direction"][] = rand() < 0.9 ? ["campus", "home"] : ["campus"];
    for (const direction of legs) {
      const at = new Date(day);
      at.setHours(direction === "campus" ? 7 : 16, Math.floor(rand() * 50) + 5, 0, 0);
      if (at > now) continue;
      const solo = rand() < 0.18;
      const rider = rand() < 0.6 ? "omar" : "khaled";
      const payer = solo ? rider : rand() < 0.55 ? "omar" : "khaled";
      const settled = solo || back > 5;
      trips.push({
        id: `demo-${back}-${direction}`,
        ride_at: at.toISOString(),
        direction,
        amount: Math.round((direction === "campus" ? 92 : 84) + rand() * 46 + (back < 40 ? 8 : 0)),
        trip_mode: solo ? "solo" : "shared",
        solo_by: solo ? rider : null,
        paid_by: payer,
        notes: notes[Math.floor(rand() * notes.length)],
        settled_at: settled && !solo ? new Date(at.getTime() + 5 * 3600_000).toISOString() : null,
        settled_by: settled && !solo ? (payer === "omar" ? "khaled" : "omar") : null,
      });
    }
  }
  return trips.reverse();
}
