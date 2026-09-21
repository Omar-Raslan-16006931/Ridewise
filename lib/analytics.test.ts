import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeTrips,
  weeklyTotal,
  dailyBudget,
  collegeDaysUsed,
  remainingBudget,
  remainingBudgetPerCollegeDay,
  budgetDifference,
  budgetPercentage,
  soloTotal,
  sharedTotal,
  campusTotal,
  homeTotal,
  busBenchmarkSavings,
  busBenchmarkPercentageUsed,
  busBenchmarkPercentageSaved,
  sharedRideSavings,
  compute2x2Matrix,
  computeSpendingByDay,
  getAcademicWeekBounds,
  toLocalDateKey,
  filterSoloTrips,
  computeSpendingTrend,
  computeDailySpendingSeries,
  personalAverageMonthlySpend,
  BUS_BENCHMARK,
} from "./analytics";
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
  assert.deepEqual(summary.totalByMember.map((member: { user_id: string; totalSpend: number }) => ({ user_id: member.user_id, totalSpend: member.totalSpend })), [
    { user_id: "omar", totalSpend: 160 },
    { user_id: "khaled", totalSpend: 80 },
  ]);
  assert.equal(summary.totalPaidByMember.find((member: { user_id: string }) => member.user_id === "omar")?.paidTotal, 180);
  assert.equal(summary.totalPaidByMember.find((member: { user_id: string }) => member.user_id === "khaled")?.paidTotal, 60);
});

test("4-day college budget calculations with edge cases", () => {
  // Weekly budget = 1500 -> Daily budget = 1500 / 4 = 375
  assert.equal(dailyBudget(1500), 375);
  assert.equal(dailyBudget(0), 0);
  assert.equal(dailyBudget(-500), 0);

  // 2 days completed out of 4:
  // Expected budget used = 2 * 375 = 750
  // If spent 900: diff = +150 (20% over)
  assert.equal(budgetDifference(900, 750), 150);
  assert.equal(budgetPercentage(900, 750), 20);

  // Remaining weekly budget = 1500 - 900 = 600
  assert.equal(remainingBudget(1500, 900), 600);
  // Remaining college days = 4 - 2 = 2
  // Remaining budget per day = 600 / 2 = 300
  assert.equal(remainingBudgetPerCollegeDay(600, 2), 300);

  // Edge case: 4 days completed (0 remaining days)
  assert.equal(remainingBudgetPerCollegeDay(100, 4), 0);
  // Edge case: 5 days completed (exceeded college days)
  assert.equal(remainingBudgetPerCollegeDay(100, 5), 0);
  // Edge case: 0 days used
  assert.equal(remainingBudgetPerCollegeDay(1500, 0), 375);
});

test("Saturday to Friday academic week bounds", () => {
  // 2026-09-21 is a Monday
  const ref = new Date("2026-09-21T12:00:00.000Z");
  const { start, end } = getAcademicWeekBounds(0, ref);

  // Saturday should be 2026-09-19
  assert.equal(start.getDay(), 6); // 6 is Saturday
  // Friday should be 2026-09-25
  assert.equal(end.getDay(), 5); // 5 is Friday
});

test("2x2 matrix and sharing savings", () => {
  const matrix = compute2x2Matrix(trips);
  assert.equal(matrix.totalSpend, 240);
  assert.equal(matrix.toCampus.shared.count, 2);
  assert.equal(matrix.toCampus.shared.spend, 160);
  assert.equal(matrix.backHome.solo.count, 1);
  assert.equal(matrix.backHome.solo.spend, 80);

  // Shared rides are 100 + 60 = 160. Saved by sharing = 160 / 2 = 80
  assert.equal(sharedRideSavings(trips), 80);
});

test("EGP 42,000 bus savings benchmark", () => {
  const total = 1864.94;
  const saved = busBenchmarkSavings(total, BUS_BENCHMARK);
  assert.equal(saved, 42000 - 1864.94);
  const usedPct = busBenchmarkPercentageUsed(total, BUS_BENCHMARK);
  assert.ok(Math.abs(usedPct - (1864.94 / 42000) * 100) < 0.01);
  const savedPct = busBenchmarkPercentageSaved(total, BUS_BENCHMARK);
  assert.ok(Math.abs(savedPct - ((42000 - 1864.94) / 42000) * 100) < 0.01);
});

test("personal budget calculates half of shared and own solo only", () => {
  const { personalTotal, personalCollegeDaysUsed, memberTripSpend } = require("./analytics");
  // trips:
  // trip 1: shared 100 -> Omar: 50, Khaled: 50
  // trip 2: solo 80 by omar -> Omar: 80, Khaled: 0
  // trip 3: shared 60 -> Omar: 30, Khaled: 30
  assert.equal(memberTripSpend(trips[0], "omar"), 50);
  assert.equal(memberTripSpend(trips[1], "omar"), 80);
  assert.equal(memberTripSpend(trips[1], "khaled"), 0);

  assert.equal(personalTotal(trips, "omar"), 160);
  assert.equal(personalTotal(trips, "khaled"), 80);

  // Omar rode on 3 days (Sept 10 shared, Sept 11 solo, Sept 12 shared)
  assert.equal(personalCollegeDaysUsed(trips, "omar"), 3);
  // Khaled only rode on 2 days (Sept 10 shared, Sept 12 shared)
  assert.equal(personalCollegeDaysUsed(trips, "khaled"), 2);
});

test("toLocalDateKey formats Date and ISO strings using local year, month, date", () => {
  const d = new Date(2026, 8, 21, 10, 30); // Sept 21, 2026 at 10:30 local
  assert.equal(toLocalDateKey(d), "2026-09-21");
  assert.equal(toLocalDateKey(""), "");
  assert.equal(toLocalDateKey(null), "");
});

test("computeSpendingByDay assigns Monday Sept 21 ride to Monday, not Tuesday", () => {
  // Monday Sept 21, 2026
  const refDate = new Date(2026, 8, 21, 10, 0, 0); // local Monday Sept 21
  const { start: weekStart } = getAcademicWeekBounds(0, refDate);

  // A ride logged on Monday Sept 21
  const mondayTrip: Trip = {
    id: "mon-ride",
    ride_at: new Date(2026, 8, 21, 10, 35, 0).toISOString(),
    direction: "campus",
    amount: 120,
    paid_by: "omar",
    notes: "Monday class",
    settled_at: null,
    settled_by: null,
    trip_mode: "shared",
    solo_by: null,
  };

  const todayIso = toLocalDateKey(refDate); // "2026-09-21"
  const { days } = computeSpendingByDay([mondayTrip], weekStart, 175, todayIso, "omar");

  // Week days: Sat(0), Sun(1), Mon(2), Tue(3), Wed(4), Thu(5), Fri(6)
  const monday = days.find((d) => d.dayName === "Mon");
  const tuesday = days.find((d) => d.dayName === "Tue");

  assert.ok(monday, "Monday entry should exist");
  assert.ok(tuesday, "Tuesday entry should exist");

  assert.equal(monday.dayFullName, "Monday");
  assert.equal(monday.dayNum, 21);
  assert.equal(monday.isToday, true);
  assert.equal(monday.ridesCount, 1);
  assert.equal(monday.actualSpend, 60); // half of 120 shared

  // Tuesday must NOT have Monday's trip!
  assert.equal(tuesday.dayFullName, "Tuesday");
  assert.equal(tuesday.dayNum, 22);
  assert.equal(tuesday.isToday, false);
  assert.equal(tuesday.ridesCount, 0);
  assert.equal(tuesday.actualSpend, 0);
});

test("filterSoloTrips handles mine, others, and all scopes accurately", () => {
  const sampleTrips: Trip[] = [
    { id: "s1", ride_at: "2026-09-10T08:00:00.000Z", direction: "campus", amount: 100, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "solo", solo_by: "omar" },
    { id: "s2", ride_at: "2026-09-11T09:00:00.000Z", direction: "home", amount: 90, paid_by: "khaled", notes: null, settled_at: null, settled_by: null, trip_mode: "solo", solo_by: "khaled" },
    { id: "s3", ride_at: "2026-09-12T10:00:00.000Z", direction: "campus", amount: 120, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "shared", solo_by: null },
  ];

  const mine = filterSoloTrips(sampleTrips, "mine", "omar");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, "s1");

  const others = filterSoloTrips(sampleTrips, "others", "omar");
  assert.equal(others.length, 1);
  assert.equal(others[0].id, "s2");

  const all = filterSoloTrips(sampleTrips, "all", "omar");
  assert.equal(all.length, 2);
});

test("computeSpendingTrend aggregates daily amounts and calculates cumulative spend", () => {
  const sampleTrips: Trip[] = [
    { id: "t1", ride_at: "2026-09-10T08:00:00.000Z", direction: "campus", amount: 100, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "shared", solo_by: null },
    { id: "t2", ride_at: "2026-09-10T16:00:00.000Z", direction: "home", amount: 80, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "solo", solo_by: "omar" },
    { id: "t3", ride_at: "2026-09-11T09:00:00.000Z", direction: "campus", amount: 120, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "shared", solo_by: null },
  ];

  // Personal spend for Omar:
  // Day 1 (Sept 10): 100/2 (50) + 80 solo (80) = 130
  // Day 2 (Sept 11): 120/2 (60) = 60. Cumulative: 130 + 60 = 190
  const trend = computeSpendingTrend(sampleTrips, "omar");
  assert.equal(trend.length, 2);
  assert.equal(trend[0].amount, 130);
  assert.equal(trend[0].cumulative, 130);
  assert.equal(trend[1].amount, 60);
  assert.equal(trend[1].cumulative, 190);
});

test("computeDailySpendingSeries returns discrete non-cumulative spending per day", () => {
  const sampleTrips: Trip[] = [
    { id: "t1", ride_at: "2026-09-10T08:00:00.000Z", direction: "campus", amount: 100, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "shared", solo_by: null },
    { id: "t2", ride_at: "2026-09-10T16:00:00.000Z", direction: "home", amount: 80, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "solo", solo_by: "omar" },
    { id: "t3", ride_at: "2026-09-11T09:00:00.000Z", direction: "campus", amount: 120, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "shared", solo_by: null },
  ];

  const series = computeDailySpendingSeries(sampleTrips, "omar");
  assert.equal(series.length, 2);
  // Day 1: 50 + 80 = 130
  assert.equal(series[0].amount, 130);
  assert.equal(series[0].ridesCount, 2);
  // Day 2: 60 (discrete, NOT 190 cumulative)
  assert.equal(series[1].amount, 60);
  assert.equal(series[1].ridesCount, 1);
});

test("personalAverageMonthlySpend is average weekly personal spend multiplied by 4", () => {
  const { personalAverageWeeklySpend, personalAverageMonthlySpend, computeMonthlyComparisonMetrics } = require("./analytics");
  const sampleTrips: Trip[] = [
    // Week 1 (Sept 8 - 14):
    { id: "t1", ride_at: "2026-09-08T08:00:00.000Z", direction: "campus", amount: 100, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "shared", solo_by: null },
    { id: "t2", ride_at: "2026-09-09T08:00:00.000Z", direction: "campus", amount: 120, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "solo", solo_by: "omar" },
    // Week 2 (Sept 15 - 21):
    { id: "t3", ride_at: "2026-09-21T08:00:00.000Z", direction: "campus", amount: 100, paid_by: "omar", notes: null, settled_at: null, settled_by: null, trip_mode: "shared", solo_by: null },
  ];

  // Omar:
  // Week 1: 50 + 120 = 170
  // Week 2: 50
  // Total: 220 across 2 weeks -> weekly avg = 110
  const weeklyAvg = personalAverageWeeklySpend(sampleTrips, "omar");
  assert.equal(weeklyAvg, 110);

  // Monthly avg = weeklyAvg * 4 = 440
  const monthlyAvg = personalAverageMonthlySpend(sampleTrips, "omar");
  assert.equal(monthlyAvg, 440);

  // Monthly comparison metrics with 700 EGP weekly budget:
  // monthlyBudgetLimit = 700 * 4 = 2800 EGP
  // Sept 2026 trips for Omar: 170 + 50 = 220 EGP
  // College days attended in Sept: Sept 8, Sept 9, Sept 21 -> 3 days
  // Expected daily = 700 / 4 = 175. Expected monthly so far = 3 * 175 = 525 EGP
  const metrics = computeMonthlyComparisonMetrics(sampleTrips, "omar", 700, new Date(2026, 8, 21));
  assert.equal(metrics.monthlyBudgetLimit, 2800);
  assert.equal(metrics.currentMonthSpend, 220);
  assert.equal(metrics.expectedMonthlySpend, 525);
  assert.equal(metrics.averageWeeklySpend, 110);
  assert.equal(metrics.averageMonthlySpend, 440);
  assert.equal(metrics.diffFromExpected, 220 - 525);
  assert.equal(metrics.diffFromLimit, 2800 - 220);
});


