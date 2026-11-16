import type { Member, Trip } from "./types";

export const BUS_BENCHMARK = 42000;
export const EXPECTED_COLLEGE_DAYS = 4;

/** College days, as JS getDay() numbers: Saturday, Sunday, Monday, Wednesday. */
export const COLLEGE_WEEKDAYS = [6, 0, 1, 3];

export function isCollegeDay(date: Date): boolean {
  return COLLEGE_WEEKDAYS.includes(date.getDay());
}

/**
 * College days still ahead in a week, counting today while today is not over.
 * Missed days are simply in the past, so their budget rolls onto the days left:
 * on Tuesday only Wednesday is left, whether or not you rode on Monday.
 */
export function collegeDaysLeft(weekStart: Date, weekEnd: Date, now: Date = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let count = 0;
  for (let d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()); d <= weekEnd; d.setDate(d.getDate() + 1)) {
    if (d >= today && isCollegeDay(d)) count += 1;
  }
  return count;
}

/** The next college day after `now` (today excluded), e.g. "Wed". */
export function nextCollegeDayLabel(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < 7; i++) {
    d.setDate(d.getDate() + 1);
    if (isCollegeDay(d)) return new Intl.DateTimeFormat("en", { weekday: "short" }).format(d);
  }
  return "";
}

export type TripSummary = {
  totalSpend: number;
  sharedTrips: number;
  soloTrips: number;
  totalByMember: {
    user_id: string;
    display_name: string;
    totalSpend: number;
  }[];
  totalPaidByMember: {
    user_id: string;
    display_name: string;
    paidTotal: number;
  }[];
};

export function summarizeTrips(trips: Trip[], members: Member[]): TripSummary {
  const totalSpend = trips.reduce((sum, trip) => sum + (Number(trip.amount) || 0), 0);
  const sharedTrips = trips.filter((trip) => trip.trip_mode === "shared").length;
  const soloTrips = trips.filter((trip) => trip.trip_mode === "solo").length;

  const totalByMember = members.map((member) => ({
    user_id: member.user_id,
    display_name: member.display_name,
    totalSpend: trips.reduce((sum, trip) => {
      const amt = Number(trip.amount) || 0;
      if (trip.trip_mode === "solo") {
        return sum + (trip.solo_by === member.user_id ? amt : 0);
      }
      return sum + amt / 2;
    }, 0),
  }));

  const totalPaidByMember = members.map((member) => ({
    user_id: member.user_id,
    display_name: member.display_name,
    paidTotal: trips
      .filter((trip) => trip.paid_by === member.user_id)
      .reduce((sum, trip) => sum + (Number(trip.amount) || 0), 0),
  }));

  return {
    totalSpend,
    sharedTrips,
    soloTrips,
    totalByMember,
    totalPaidByMember,
  };
}

/**
 * Returns the Saturday 00:00:00 to Friday 23:59:59.999 boundary for a given offset in weeks.
 * Saturday is index 0 in the academic week.
 */
export function getAcademicWeekBounds(offsetWeeks = 0, referenceDate: Date = new Date()) {
  const ref = new Date(referenceDate);
  // In JS getDay(): 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  // We want Saturday to be index 0:
  const day = ref.getDay();
  const daysSinceSaturday = (day + 1) % 7;

  const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - daysSinceSaturday + (offsetWeeks * 7), 0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);

  return { start, end };
}

/**
 * Computes total spending for a set of trips.
 */
export function weeklyTotal(trips: Trip[]): number {
  if (!trips || trips.length === 0) return 0;
  return trips.reduce((sum, trip) => sum + (Number(trip.amount) || 0), 0);
}

/**
 * Returns YYYY-MM-DD representing the local calendar day for a given Date or ISO string.
 * Avoids UTC timezone conversion shifts (e.g. UTC+2/UTC+3 turning local midnight into the previous day).
 */
export function toLocalDateKey(dateInput?: Date | string | null): string {
  if (!dateInput) return "";
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Computes the daily college-day budget. Always divides by college days (4), never by 7.
 */
export function dailyBudget(weeklyBudget: number, collegeDays = EXPECTED_COLLEGE_DAYS): number {
  if (!weeklyBudget || weeklyBudget <= 0 || collegeDays <= 0) return 0;
  return weeklyBudget / collegeDays;
}

/**
 * Counts unique active college days (dates with at least 1 ride) in the trips using local calendar days.
 */
export function collegeDaysUsed(trips: Trip[]): number {
  if (!trips || trips.length === 0) return 0;
  const uniqueDates = new Set(
    trips
      .filter((trip) => trip && trip.ride_at)
      .map((trip) => toLocalDateKey(trip.ride_at))
      .filter((key) => key.length > 0)
  );
  return uniqueDates.size;
}

/**
 * Calculates remaining weekly budget.
 */
export function remainingBudget(weeklyBudget: number, actualSpent: number): number {
  return (weeklyBudget || 0) - (actualSpent || 0);
}

/**
 * Calculates remaining budget per remaining college day.
 * Capped to avoid division by zero or negative remaining days.
 */
export function remainingBudgetPerCollegeDay(
  remaining: number,
  usedDays: number,
  totalDays = EXPECTED_COLLEGE_DAYS
): number {
  const remainingDays = Math.max(0, totalDays - usedDays);
  if (remainingDays <= 0) return 0;
  return remaining / remainingDays;
}

/**
 * Computes the raw difference between actual spending and expected budget.
 */
export function budgetDifference(actualSpent: number, expectedBudget: number): number {
  return (actualSpent || 0) - (expectedBudget || 0);
}

/**
 * Computes percentage over or under budget relative to expected budget.
 * Returns 0 if expected budget is 0 to avoid Infinity/NaN.
 */
export function budgetPercentage(actualSpent: number, expectedBudget: number): number {
  if (!expectedBudget || expectedBudget <= 0) return 0;
  return ((actualSpent - expectedBudget) / expectedBudget) * 100;
}

/**
 * Total solo spending across all trips.
 */
export function soloTotal(trips: Trip[]): number {
  if (!trips || trips.length === 0) return 0;
  return trips
    .filter((trip) => trip.trip_mode === "solo")
    .reduce((sum, trip) => sum + (Number(trip.amount) || 0), 0);
}

/**
 * Total shared spending across all trips.
 */
export function sharedTotal(trips: Trip[]): number {
  if (!trips || trips.length === 0) return 0;
  return trips
    .filter((trip) => trip.trip_mode === "shared")
    .reduce((sum, trip) => sum + (Number(trip.amount) || 0), 0);
}

/**
 * Calculates a specific member's share for a trip:
 * - If shared: 50% of trip.amount (trip.amount / 2)
 * - If solo: 100% of trip.amount IF trip.solo_by === memberId, otherwise 0
 */
export function memberTripSpend(trip: Trip, memberId: string): number {
  const amt = Number(trip.amount) || 0;
  if (trip.trip_mode === "solo") {
    return trip.solo_by === memberId ? amt : 0;
  }
  return amt / 2;
}

/**
 * Calculates a specific member's total personal transportation spend across trips:
 * (half of shared + own solo only)
 */
export function personalTotal(trips: Trip[], memberId: string): number {
  if (!trips || trips.length === 0 || !memberId) return 0;
  return trips.reduce((sum, trip) => sum + memberTripSpend(trip, memberId), 0);
}

/**
 * Counts unique college days that this specific member had a commute
 * (either a shared ride, or their own solo ride).
 */
export function personalCollegeDaysUsed(trips: Trip[], memberId: string): number {
  if (!trips || trips.length === 0 || !memberId) return 0;
  const personalTrips = trips.filter((trip) => {
    if (trip.trip_mode === "solo") return trip.solo_by === memberId;
    return true; // shared trip includes both members
  });
  return collegeDaysUsed(personalTrips);
}

/**
 * Today's personal allowance. On a college day it is what is left of the weekly
 * budget (before today's rides) shared over the college days left, today included.
 * So a missed day's money moves onto the remaining days. On other days it is 0.
 */
export function computeTodayBudget(
  trips: Trip[],
  memberId: string,
  weeklyBudget: number,
  referenceDate: Date = new Date()
) {
  const todayIso = toLocalDateKey(referenceDate);
  const todayTrips = trips.filter((t) => toLocalDateKey(t.ride_at) === todayIso);
  const todayActualSpend = personalTotal(todayTrips, memberId);
  const todayRidesCount = todayTrips.filter((t) => t.trip_mode === "shared" || t.solo_by === memberId).length;

  const { start: weekStart, end: weekEnd } = getAcademicWeekBounds(0, referenceDate);
  const startOfToday = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const spentBeforeToday = personalTotal(
    trips.filter((t) => {
      const d = new Date(t.ride_at);
      return d >= weekStart && d < startOfToday;
    }),
    memberId
  );

  const collegeDay = isCollegeDay(referenceDate);
  const daysLeft = collegeDaysLeft(weekStart, weekEnd, referenceDate);
  const todayBudget =
    collegeDay && daysLeft > 0 && weeklyBudget > 0 ? Math.max(0, weeklyBudget - spentBeforeToday) / daysLeft : 0;
  const todayRemaining = todayBudget - todayActualSpend;
  const todayPct = todayBudget > 0 ? (todayActualSpend / todayBudget) * 100 : todayActualSpend > 0 ? 100 : 0;
  const isOverBudget = todayRemaining < 0;

  return {
    todayIso,
    todayTrips,
    todayActualSpend,
    todayRidesCount,
    todayBudget,
    todayRemaining,
    todayPct,
    isOverBudget,
    isCollegeDay: collegeDay,
    collegeDaysLeft: daysLeft,
    nextCollegeDay: nextCollegeDayLabel(referenceDate),
  };
}

/**
 * Total spending for rides to campus.
 */
export function campusTotal(trips: Trip[]): number {
  if (!trips || trips.length === 0) return 0;
  return trips
    .filter((trip) => trip.direction === "campus")
    .reduce((sum, trip) => sum + (Number(trip.amount) || 0), 0);
}

/**
 * Total spending for rides back home.
 */
export function homeTotal(trips: Trip[]): number {
  if (!trips || trips.length === 0) return 0;
  return trips
    .filter((trip) => trip.direction === "home")
    .reduce((sum, trip) => sum + (Number(trip.amount) || 0), 0);
}

/**
 * Difference between bus benchmark (EGP 42,000) and actual spending.
 */
export function busBenchmarkSavings(totalSpent: number, benchmark = BUS_BENCHMARK): number {
  return (benchmark || 0) - (totalSpent || 0);
}

/**
 * Percentage of the EGP 42,000 bus benchmark used so far.
 */
export function busBenchmarkPercentageUsed(totalSpent: number, benchmark = BUS_BENCHMARK): number {
  if (!benchmark || benchmark <= 0) return 0;
  const pct = ((totalSpent || 0) / benchmark) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Percentage of the EGP 42,000 bus benchmark saved so far.
 */
export function busBenchmarkPercentageSaved(totalSpent: number, benchmark = BUS_BENCHMARK): number {
  if (!benchmark || benchmark <= 0) return 100;
  const pct = (((benchmark - (totalSpent || 0))) / benchmark) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Money saved by sharing rides compared with paying the full cost alone.
 * For every shared trip, each rider pays half. Therefore, the shared split saves 50% of each shared ride.
 */
export function sharedRideSavings(trips: Trip[]): number {
  if (!trips || trips.length === 0) return 0;
  return trips
    .filter((trip) => trip.trip_mode === "shared")
    .reduce((sum, trip) => sum + ((Number(trip.amount) || 0) / 2), 0);
}

export type MatrixCell = {
  count: number;
  spend: number;
  average: number;
  percentage: number;
};

export type Matrix2x2 = {
  toCampus: {
    solo: MatrixCell;
    shared: MatrixCell;
    totalSpend: number;
    totalCount: number;
  };
  backHome: {
    solo: MatrixCell;
    shared: MatrixCell;
    totalSpend: number;
    totalCount: number;
  };
  totalSpend: number;
  totalRides: number;
};

/**
 * Computes the 2x2 matrix:
 * TO CAMPUS (Solo / Shared) × BACK HOME (Solo / Shared)
 */
export function compute2x2Matrix(trips: Trip[]): Matrix2x2 {
  const totalSpend = weeklyTotal(trips);
  const totalRides = trips.length;

  const buildCell = (scoped: Trip[]): MatrixCell => {
    const count = scoped.length;
    const spend = weeklyTotal(scoped);
    const average = count > 0 ? spend / count : 0;
    const percentage = totalSpend > 0 ? (spend / totalSpend) * 100 : 0;
    return { count, spend, average, percentage };
  };

  const campusTrips = trips.filter((t) => t.direction === "campus");
  const homeTrips = trips.filter((t) => t.direction === "home");

  const campusSolo = campusTrips.filter((t) => t.trip_mode === "solo");
  const campusShared = campusTrips.filter((t) => t.trip_mode === "shared");

  const homeSolo = homeTrips.filter((t) => t.trip_mode === "solo");
  const homeShared = homeTrips.filter((t) => t.trip_mode === "shared");

  return {
    toCampus: {
      solo: buildCell(campusSolo),
      shared: buildCell(campusShared),
      totalSpend: weeklyTotal(campusTrips),
      totalCount: campusTrips.length,
    },
    backHome: {
      solo: buildCell(homeSolo),
      shared: buildCell(homeShared),
      totalSpend: weeklyTotal(homeTrips),
      totalCount: homeTrips.length,
    },
    totalSpend,
    totalRides,
  };
}

export type DaySpendingItem = {
  dayName: string;
  dayFullName: string;
  dayNum: number;
  dateStr: string;
  isoDate: string;
  actualSpend: number;
  expectedDailyBudget: number;
  difference: number;
  isCollegeDay: boolean;
  isToday: boolean;
  ridesCount: number;
  campusSpend: number;
  homeSpend: number;
  campusCount: number;
  homeCount: number;
};

/**
 * Computes Saturday → Friday spending by day.
 * If memberId is supplied, calculates personal daily spending (half of shared + own solo only).
 */
export function computeSpendingByDay(
  allTrips: Trip[],
  weekStart: Date,
  dailyCollegeBudget: number,
  todayIso: string,
  memberId?: string
): { days: DaySpendingItem[]; maxSpend: number } {
  const dayNames = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
  const dayFullNames = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  let maxSpend = dailyCollegeBudget || 1;

  const days: DaySpendingItem[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    const isoDate = toLocalDateKey(d);
    const dayTrips = allTrips.filter((t) => toLocalDateKey(t.ride_at) === isoDate);

    const actualSpend = memberId ? personalTotal(dayTrips, memberId) : weeklyTotal(dayTrips);
    if (actualSpend > maxSpend) maxSpend = actualSpend;

    const campusTrips = dayTrips.filter((t) => t.direction === "campus");
    const homeTrips = dayTrips.filter((t) => t.direction === "home");
    const campusSpend = memberId
      ? campusTrips.reduce((sum, t) => sum + memberTripSpend(t, memberId), 0)
      : weeklyTotal(campusTrips);
    const homeSpend = memberId
      ? homeTrips.reduce((sum, t) => sum + memberTripSpend(t, memberId), 0)
      : weeklyTotal(homeTrips);

    const relevantTrips = memberId
      ? dayTrips.filter((t) => t.trip_mode === "shared" || t.solo_by === memberId)
      : dayTrips;
    const isCollegeDay = relevantTrips.length > 0;
    const difference = actualSpend - dailyCollegeBudget;
    const isToday = isoDate === todayIso;

    return {
      dayName: dayNames[i],
      dayFullName: dayFullNames[i],
      dayNum: d.getDate(),
      dateStr: d.toLocaleDateString("en", { month: "short", day: "numeric" }),
      isoDate,
      actualSpend,
      expectedDailyBudget: dailyCollegeBudget,
      difference,
      isCollegeDay,
      isToday,
      ridesCount: relevantTrips.length,
      campusSpend,
      homeSpend,
      campusCount: campusTrips.length,
      homeCount: homeTrips.length,
    };
  });

  return { days, maxSpend };
}

/**
 * Generates 100% factual, data-derived insights from real calculations.
 */
export function generateFactualInsights(params: {
  actualSpent: number;
  expectedBudgetUsed: number;
  weeklyBudget: number;
  usedDays: number;
  days: DaySpendingItem[];
  allTrips: Trip[];
  totalAllTimeSpend: number;
  sharingSavings: number;
  currencyFormatter: Intl.NumberFormat;
}): string[] {
  const {
    actualSpent,
    expectedBudgetUsed,
    weeklyBudget,
    usedDays,
    days,
    allTrips,
    totalAllTimeSpend,
    sharingSavings,
    currencyFormatter,
  } = params;

  const insights: string[] = [];

  // 1. Budget Adherence Insight
  if (weeklyBudget > 0) {
    if (usedDays === 0) {
      insights.push(`Your ${currencyFormatter.format(weeklyBudget)} weekly budget is ready across 4 college days (${currencyFormatter.format(weeklyBudget / 4)}/day).`);
    } else {
      const diff = actualSpent - expectedBudgetUsed;
      const pct = expectedBudgetUsed > 0 ? Math.abs(Math.round((diff / expectedBudgetUsed) * 100)) : 0;
      if (diff > 0) {
        insights.push(`You are currently ${currencyFormatter.format(diff)} (${pct}%) over your college budget for the ${usedDays} active ${usedDays === 1 ? "day" : "days"} so far.`);
      } else if (diff < 0) {
        insights.push(`You are currently ${currencyFormatter.format(Math.abs(diff))} (${pct}%) under your college budget across ${usedDays} active ${usedDays === 1 ? "day" : "days"}.`);
      } else {
        insights.push(`Your spending is perfectly on budget at ${currencyFormatter.format(actualSpent)} across ${usedDays} active college days.`);
      }
    }
  }

  // 2. Highest Spending Day
  const activeDaysWithSpend = days.filter((d) => d.actualSpend > 0);
  if (activeDaysWithSpend.length > 0) {
    const highestDay = [...activeDaysWithSpend].sort((a, b) => b.actualSpend - a.actualSpend)[0];
    insights.push(`${highestDay.dayFullName} was your highest-spending day this week at ${currencyFormatter.format(highestDay.actualSpend)} across ${highestDay.ridesCount} ${highestDay.ridesCount === 1 ? "ride" : "rides"}.`);
  }

  // 3. Sharing Savings
  if (sharingSavings > 0) {
    insights.push(`Sharing rides has saved a total of ${currencyFormatter.format(sharingSavings)} compared to paying full solo fares.`);
  }

  // 4. Bus Benchmark Comparison
  const busSaved = BUS_BENCHMARK - totalAllTimeSpend;
  const busPctSaved = busBenchmarkPercentageSaved(totalAllTimeSpend);
  if (busSaved > 0) {
    insights.push(`Total Uber spending is ${currencyFormatter.format(busSaved)} below the hypothetical EGP 42,000 bus cost (${busPctSaved.toFixed(1)}% preserved).`);
  } else {
    insights.push(`Total Uber spending has reached ${currencyFormatter.format(totalAllTimeSpend)}, surpassing the EGP 42,000 bus benchmark.`);
  }

  // 5. Solo vs Shared proportion
  const soloSpend = soloTotal(allTrips);
  const totalSpend = weeklyTotal(allTrips);
  if (totalSpend > 0) {
    const soloPct = Math.round((soloSpend / totalSpend) * 100);
    insights.push(`Solo rides represent ${soloPct}% of all-time ride spending (${currencyFormatter.format(soloSpend)}).`);
  }

  return insights;
}

export type SoloScope = "mine" | "all" | "others";

/**
 * Filters solo trips according to scope:
 * - "mine": only solo trips taken by currentUserId
 * - "others": only solo trips taken by someone other than currentUserId
 * - "all": all solo trips in the group
 */
export function filterSoloTrips(trips: Trip[], scope: SoloScope, currentUserId?: string): Trip[] {
  if (!trips || trips.length === 0) return [];
  const soloTrips = trips.filter((t) => t.trip_mode === "solo");
  if (scope === "mine") {
    return currentUserId ? soloTrips.filter((t) => t.solo_by === currentUserId) : soloTrips;
  }
  if (scope === "others") {
    return currentUserId ? soloTrips.filter((t) => t.solo_by !== currentUserId) : [];
  }
  return soloTrips;
}

export type TrendDataPoint = {
  date: string;
  label: string;
  amount: number;
  cumulative: number;
};

/**
 * Computes cumulative spending trend points across trips sorted chronologically.
 * If memberId is provided, calculates personal share (half of shared + own solo).
 */
export function computeSpendingTrend(trips: Trip[], memberId?: string): TrendDataPoint[] {
  if (!trips || trips.length === 0) return [];

  const sorted = [...trips].sort((a, b) => new Date(a.ride_at).getTime() - new Date(b.ride_at).getTime());
  const byDate = new Map<string, { label: string; amount: number }>();

  for (const t of sorted) {
    const key = toLocalDateKey(t.ride_at);
    if (!key) continue;
    const spend = memberId ? memberTripSpend(t, memberId) : (Number(t.amount) || 0);
    const dateObj = new Date(t.ride_at);
    const label = dateObj.toLocaleDateString("en", { month: "short", day: "numeric" });
    const existing = byDate.get(key);
    if (existing) {
      existing.amount += spend;
    } else {
      byDate.set(key, { label, amount: spend });
    }
  }

  let running = 0;
  const points: TrendDataPoint[] = [];
  for (const [date, val] of byDate.entries()) {
    running += val.amount;
    points.push({
      date,
      label: val.label,
      amount: val.amount,
      cumulative: running,
    });
  }

  return points;
}

export type DailySpendPoint = {
  date: string;
  label: string;
  dayName: string;
  amount: number;
  ridesCount: number;
};

/**
 * Computes non-cumulative discrete daily spending data points across trips sorted chronologically.
 * If memberId is provided, calculates personal share for each day.
 */
export function computeDailySpendingSeries(trips: Trip[], memberId?: string): DailySpendPoint[] {
  if (!trips || trips.length === 0) return [];

  const sorted = [...trips].sort((a, b) => new Date(a.ride_at).getTime() - new Date(b.ride_at).getTime());
  const byDate = new Map<string, { label: string; dayName: string; amount: number; count: number }>();

  for (const t of sorted) {
    const key = toLocalDateKey(t.ride_at);
    if (!key) continue;
    const spend = memberId ? memberTripSpend(t, memberId) : (Number(t.amount) || 0);
    const [y, m, d] = key.split("-").map(Number);
    const localDate = new Date(y, m - 1, d);
    const label = localDate.toLocaleDateString("en", { month: "short", day: "numeric" });
    const dayName = localDate.toLocaleDateString("en", { weekday: "short" });
    const existing = byDate.get(key);
    if (existing) {
      existing.amount += spend;
      existing.count += 1;
    } else {
      byDate.set(key, { label, dayName, amount: spend, count: 1 });
    }
  }

  const series: DailySpendPoint[] = [];
  for (const [date, val] of byDate.entries()) {
    series.push({
      date,
      label: val.label,
      dayName: val.dayName,
      amount: val.amount,
      ridesCount: val.count,
    });
  }

  return series;
}

/**
 * Calculates average weekly personal commute spending for a specific member only.
 * Based on personal trips (half of shared + own solo) divided by active academic weeks.
 */
export function personalAverageWeeklySpend(trips: Trip[], memberId: string): number {
  if (!trips || trips.length === 0 || !memberId) return 0;
  const personalTrips = trips.filter((t) => t.trip_mode === "shared" || t.solo_by === memberId);
  if (personalTrips.length === 0) return 0;

  const totalSpend = personalTrips.reduce((sum, t) => sum + memberTripSpend(t, memberId), 0);

  // Group trips into unique academic weeks (Sat -> Fri)
  const weekKeys = new Set<string>();
  for (const t of personalTrips) {
    const { start } = getAcademicWeekBounds(0, new Date(t.ride_at));
    weekKeys.add(toLocalDateKey(start));
  }

  const activeWeeks = Math.max(1, weekKeys.size);
  return totalSpend / activeWeeks;
}

/**
 * Counts unique days where a specific member logged a commute
 * (either a shared ride, or their own solo ride).
 */
export function personalLoggedDaysCount(trips: Trip[], memberId: string): number {
  if (!trips || trips.length === 0 || !memberId) return 0;
  const personalTrips = trips.filter((t) => t.trip_mode === "shared" || t.solo_by === memberId);
  const days = new Set<string>();
  for (const t of personalTrips) {
    days.add(toLocalDateKey(t.ride_at));
  }
  return days.size;
}

/**
 * Calculates estimated average monthly commute spending for a specific member only.
 * Defined strictly by taking average personal spending of all logged days then * 4 then * 4.
 */
export function personalAverageMonthlySpend(trips: Trip[], memberId: string): number {
  if (!trips || trips.length === 0 || !memberId) return 0;
  const loggedDays = personalLoggedDaysCount(trips, memberId);
  if (loggedDays === 0) return 0;
  const totalPersonalSpend = personalTotal(trips, memberId);
  const avgPerDay = totalPersonalSpend / loggedDays;
  return avgPerDay * 4 * 4;
}

export type MonthlyComparisonMetrics = {
  currentMonthSpend: number;
  expectedMonthlySpend: number;
  monthlyBudgetLimit: number;
  averageSpendPerDay: number;
  averageWeeklySpend: number;
  averageMonthlySpend: number;
  diffFromExpected: number;
  diffFromLimit: number;
  pctOfLimit: number;
  pctOfExpectedOnLimit: number;
  loggedDaysCount: number;
  statusColor: "green" | "yellow" | "red";
};

/**
 * Computes:
 * 1. Current monthly spending (personal spend in the current calendar month)
 * 2. Expected monthly spending (average spend of all logged days * 4 * 4)
 * 3. Budget limit (weeklyBudget * 4)
 * 4. Pct where expected lies on the limit progress bar (for dotted line)
 * 5. Dynamic status color (green -> yellow after expected -> red near budget)
 */
export function computeMonthlyComparisonMetrics(
  trips: Trip[],
  memberId: string,
  weeklyBudget: number,
  now = new Date()
): MonthlyComparisonMetrics {
  const monthlyBudgetLimit = (weeklyBudget || 0) * 4;
  const loggedDaysCount = personalLoggedDaysCount(trips, memberId);
  const totalPersonalSpend = personalTotal(trips, memberId);

  // Average of all logged days then x4 (weekly) then x4 (monthly)
  const averageSpendPerDay = loggedDaysCount > 0 ? totalPersonalSpend / loggedDaysCount : 0;
  const averageWeeklySpend = averageSpendPerDay * 4;
  const expectedMonthlySpend = averageSpendPerDay * 4 * 4;
  const averageMonthlySpend = expectedMonthlySpend;

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const currentMonthTrips = (trips || []).filter((t) => {
    const d = new Date(t.ride_at);
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  });

  const currentMonthSpend = personalTotal(currentMonthTrips, memberId);
  const diffFromExpected = currentMonthSpend - expectedMonthlySpend;
  const diffFromLimit = monthlyBudgetLimit - currentMonthSpend;
  const pctOfLimit = monthlyBudgetLimit > 0 ? (currentMonthSpend / monthlyBudgetLimit) * 100 : 0;
  const pctOfExpectedOnLimit = monthlyBudgetLimit > 0 ? (expectedMonthlySpend / monthlyBudgetLimit) * 100 : 0;

  // Status color: green, yellow after expected, red near budget (>= 85% of limit or over)
  let statusColor: "green" | "yellow" | "red" = "green";
  if (monthlyBudgetLimit > 0 && currentMonthSpend >= monthlyBudgetLimit * 0.85) {
    statusColor = "red";
  } else if (expectedMonthlySpend > 0 && currentMonthSpend > expectedMonthlySpend) {
    statusColor = "yellow";
  } else {
    statusColor = "green";
  }

  return {
    currentMonthSpend,
    expectedMonthlySpend,
    monthlyBudgetLimit,
    averageSpendPerDay,
    averageWeeklySpend,
    averageMonthlySpend,
    diffFromExpected,
    diffFromLimit,
    pctOfLimit,
    pctOfExpectedOnLimit,
    loggedDaysCount,
    statusColor,
  };
}


/* ---------------------------------------------------------------------------
 * Month-by-month history
 * ------------------------------------------------------------------------- */

export type MonthDayPoint = {
  day: number;
  isoDate: string;
  /** This member's share of the day's rides. */
  amount: number;
  campusAmount: number;
  homeAmount: number;
  rides: number;
  isCollegeDay: boolean;
  isToday: boolean;
  isFuture: boolean;
};

export type MonthSummary = {
  /** "2026-11" */
  key: string;
  year: number;
  /** 0-based, like Date#getMonth(). */
  month: number;
  label: string;
  shortLabel: string;
  isCurrent: boolean;
  /** Every ride in the space this month. */
  rides: number;
  /** Rides this member was on (shared rides + their own solo rides). */
  myRides: number;
  groupSpend: number;
  mySpend: number;
  mySharedSpend: number;
  mySoloSpend: number;
  campusSpend: number;
  homeSpend: number;
  campusRides: number;
  homeRides: number;
  sharedRides: number;
  soloRides: number;
  /** Full fares this member paid Uber up front. */
  paidByMe: number;
  paidByOthers: number;
  activeDays: number;
  avgPerRide: number;
  avgPerActiveDay: number;
  /** What sharing saved this member compared with riding alone. */
  sharingSaved: number;
  biggestRide: Trip | null;
  busiestDay: MonthDayPoint | null;
  days: MonthDayPoint[];
  /** Newest first. */
  trips: Trip[];
};

export function monthKeyOf(dateInput: Date | string): string {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isMemberOnTrip(trip: Trip, memberId: string): boolean {
  return trip.trip_mode === "shared" || trip.solo_by === memberId;
}

/** Summary of one calendar month for one member. */
export function summarizeMonth(
  allTrips: Trip[],
  memberId: string,
  year: number,
  month: number,
  now: Date = new Date()
): MonthSummary {
  const first = new Date(year, month, 1);
  const key = monthKeyOf(first);
  const trips = (allTrips || [])
    .filter((t) => t && t.ride_at && monthKeyOf(t.ride_at) === key)
    .sort((a, b) => new Date(b.ride_at).getTime() - new Date(a.ride_at).getTime());
  const mine = trips.filter((t) => isMemberOnTrip(t, memberId));
  const todayIso = toLocalDateKey(now);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days: MonthDayPoint[] = Array.from({ length: daysInMonth }, (_, i) => {
    const date = new Date(year, month, i + 1);
    const isoDate = toLocalDateKey(date);
    const dayTrips = mine.filter((t) => toLocalDateKey(t.ride_at) === isoDate);
    const campusAmount = dayTrips.filter((t) => t.direction === "campus").reduce((s, t) => s + memberTripSpend(t, memberId), 0);
    const homeAmount = dayTrips.filter((t) => t.direction === "home").reduce((s, t) => s + memberTripSpend(t, memberId), 0);
    return {
      day: i + 1,
      isoDate,
      amount: campusAmount + homeAmount,
      campusAmount,
      homeAmount,
      rides: dayTrips.length,
      isCollegeDay: isCollegeDay(date),
      isToday: isoDate === todayIso,
      isFuture: isoDate > todayIso,
    };
  });

  const mySpend = personalTotal(trips, memberId);
  const activeDays = days.filter((d) => d.rides > 0).length;
  const shared = trips.filter((t) => t.trip_mode === "shared");
  const mySolo = trips.filter((t) => t.trip_mode === "solo" && t.solo_by === memberId);
  const campus = mine.filter((t) => t.direction === "campus");
  const home = mine.filter((t) => t.direction === "home");
  const biggestRide = mine.reduce<Trip | null>(
    (top, t) => (!top || memberTripSpend(t, memberId) > memberTripSpend(top, memberId) ? t : top),
    null
  );
  const busiestDay = days.reduce<MonthDayPoint | null>((top, d) => (d.amount > 0 && (!top || d.amount > top.amount) ? d : top), null);

  return {
    key,
    year,
    month,
    label: first.toLocaleDateString("en", { month: "long", year: "numeric" }),
    shortLabel: first.toLocaleDateString("en", { month: "short" }),
    isCurrent: key === monthKeyOf(now),
    rides: trips.length,
    myRides: mine.length,
    groupSpend: weeklyTotal(trips),
    mySpend,
    mySharedSpend: sharedTotal(trips) / 2,
    mySoloSpend: weeklyTotal(mySolo),
    campusSpend: campus.reduce((s, t) => s + memberTripSpend(t, memberId), 0),
    homeSpend: home.reduce((s, t) => s + memberTripSpend(t, memberId), 0),
    campusRides: campus.length,
    homeRides: home.length,
    sharedRides: shared.length,
    soloRides: mySolo.length,
    paidByMe: weeklyTotal(trips.filter((t) => t.paid_by === memberId)),
    paidByOthers: weeklyTotal(trips.filter((t) => t.paid_by !== memberId)),
    activeDays,
    avgPerRide: mine.length > 0 ? mySpend / mine.length : 0,
    avgPerActiveDay: activeDays > 0 ? mySpend / activeDays : 0,
    sharingSaved: sharedRideSavings(trips),
    biggestRide,
    busiestDay,
    days,
    trips,
  };
}

/**
 * Every month from the first logged ride up to the current month, oldest first.
 * Months without rides are included so the timeline has no gaps. Always has the current month.
 */
export function computeMonthlyHistory(trips: Trip[], memberId: string, now: Date = new Date()): MonthSummary[] {
  const valid = (trips || []).filter((t) => t && t.ride_at && !isNaN(new Date(t.ride_at).getTime()));
  let cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  for (const t of valid) {
    const d = new Date(t.ride_at);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    if (start < cursor) cursor = start;
  }
  // Rides dated in the future (a mistyped date) still get a month.
  let last = new Date(now.getFullYear(), now.getMonth(), 1);
  for (const t of valid) {
    const d = new Date(t.ride_at);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    if (start > last) last = start;
  }
  const months: MonthSummary[] = [];
  for (let d = new Date(cursor); d <= last; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push(summarizeMonth(valid, memberId, d.getFullYear(), d.getMonth(), now));
  }
  return months;
}

/** This member's spending from the 1st up to and including `day` of the month. */
export function spendThroughDay(summary: MonthSummary, day: number): number {
  return summary.days.filter((d) => d.day <= day).reduce((s, d) => s + d.amount, 0);
}

export type MonthProjection = {
  elapsedCollegeDays: number;
  totalCollegeDays: number;
  /** Month-end estimate at the current pace per college day. Equals mySpend for finished months. */
  projected: number;
};

/** Estimates where the current month will end, using the pace per college day so far. */
export function projectMonthSpend(summary: MonthSummary, now: Date = new Date()): MonthProjection {
  const totalCollegeDays = summary.days.filter((d) => d.isCollegeDay).length;
  if (!summary.isCurrent) {
    return { elapsedCollegeDays: totalCollegeDays, totalCollegeDays, projected: summary.mySpend };
  }
  const today = now.getDate();
  const elapsedCollegeDays = summary.days.filter((d) => d.isCollegeDay && d.day <= today).length;
  const projected = elapsedCollegeDays > 0 ? (summary.mySpend / elapsedCollegeDays) * totalCollegeDays : summary.mySpend;
  return { elapsedCollegeDays, totalCollegeDays, projected: Math.max(projected, summary.mySpend) };
}

export type MonthComparison = {
  /** Spending this month minus the baseline. Negative means spending less. */
  diff: number;
  pct: number;
  baseline: number;
  /** True when comparing against the same day-of-month in the previous month (month still running). */
  samePoint: boolean;
};

/**
 * Compares a month with the one before it. A month still in progress is compared with
 * the previous month up to the same day, so a half-finished month is not flattered.
 */
export function compareWithPreviousMonth(
  current: MonthSummary,
  previous: MonthSummary | null | undefined,
  now: Date = new Date()
): MonthComparison | null {
  if (!previous) return null;
  const samePoint = current.isCurrent;
  const baseline = samePoint ? spendThroughDay(previous, now.getDate()) : previous.mySpend;
  if (baseline <= 0) return null;
  const diff = current.mySpend - baseline;
  return { diff, pct: (diff / baseline) * 100, baseline, samePoint };
}
