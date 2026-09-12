import assert from "node:assert/strict";
import test from "node:test";

import { summarizeTrips } from "./analytics";
import type { Member, Trip } from "./types";

const members: Member[] = [
  { user_id: "omar", display_name: "Omar" },
  { user_id: "khaled", display_name: "Khaled" },
];

const trips: Trip[] = [
  { id: "1", ride_at: "2026-09-10T07:00:00.000Z", direction: "campus", amount: 100, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "shared", solo_by: null },
  { id: "2", ride_at: "2026-09-11T08:00:00.000Z", direction: "home", amount: 80, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "solo", solo_by: "omar" },
  { id: "3", ride_at: "2026-09-12T09:00:00.000Z", direction: "campus", amount: 60, paid_by: "khaled", notes: null, settled_at: null, settled_by: null, trip_mode: "shared", solo_by: null },
];

test("summarizeTrips includes solo rides and shared rides in every total", () => {
  const summary = summarizeTrips(trips, members);

  assert.equal(summary.totalSpend, 240);
  assert.equal(summary.sharedTrips, 2);
  assert.equal(summary.soloTrips, 1);
  assert.deepEqual(summary.totalByMember.map((member) => ({ user_id: member.user_id, totalSpend: member.totalSpend })), [
    { user_id: "omar", totalSpend: 140 },
    { user_id: "khaled", totalSpend: 100 },
  ]);
  assert.equal(summary.totalPaidByMember.find((member) => member.user_id === "omar")?.paidTotal, 180);
  assert.equal(summary.totalPaidByMember.find((member) => member.user_id === "khaled")?.paidTotal, 60);
});
