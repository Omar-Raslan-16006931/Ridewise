"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "../lib/supabase";
import type { Member, RideGroup, Trip } from "../lib/types";
import {
  BUS_BENCHMARK,
  EXPECTED_COLLEGE_DAYS,
  getAcademicWeekBounds,
  weeklyTotal,
  dailyBudget,
  collegeDaysUsed,
  remainingBudget,
  remainingBudgetPerCollegeDay,
  budgetDifference,
  budgetPercentage,
  soloTotal,
  sharedTotal,
  personalTotal,
  personalCollegeDaysUsed,
  memberTripSpend,
  busBenchmarkSavings,
  busBenchmarkPercentageUsed,
  busBenchmarkPercentageSaved,
  sharedRideSavings,
  compute2x2Matrix,
  computeSpendingByDay,
  generateFactualInsights,
  toLocalDateKey,
  filterSoloTrips,
  computeSpendingTrend,
  computeDailySpendingSeries,
  personalAverageWeeklySpend,
  personalAverageMonthlySpend,
  computeMonthlyComparisonMetrics,
  type SoloScope,
  type TrendDataPoint,
  type DailySpendPoint,
  type MonthlyComparisonMetrics,
} from "../lib/analytics";

const demoGroup: RideGroup = { id: "demo-group", name: "Omar + Khaled", invite_code: "RIDE2026" };
const demoMembers: Member[] = [
  { user_id: "omar", display_name: "Omar" },
  { user_id: "khaled", display_name: "Khaled" },
];
const demoTrips: Trip[] = [
  { id: "1", ride_at: "2026-09-12T07:42:00.000Z", direction: "campus", amount: 118, trip_mode: "shared", solo_by: null, paid_by: "omar", notes: "Morning lecture", settled_at: null, settled_by: null },
  { id: "2", ride_at: "2026-09-11T16:18:00.000Z", direction: "home", amount: 96, trip_mode: "shared", solo_by: null, paid_by: "khaled", notes: null, settled_at: null, settled_by: null },
  { id: "3", ride_at: "2026-09-10T07:50:00.000Z", direction: "campus", amount: 110, trip_mode: "shared", solo_by: null, paid_by: "khaled", notes: "Traffic was wild", settled_at: "2026-09-10T13:04:00.000Z", settled_by: "omar" },
  { id: "4", ride_at: "2026-09-09T16:05:00.000Z", direction: "home", amount: 102, trip_mode: "solo", solo_by: "omar", paid_by: "omar", notes: null, settled_at: "2026-09-09T19:20:00.000Z", settled_by: "khaled" },
  { id: "5", ride_at: "2026-09-08T08:11:00.000Z", direction: "campus", amount: 124, trip_mode: "shared", solo_by: null, paid_by: "omar", notes: null, settled_at: "2026-09-08T13:12:00.000Z", settled_by: "khaled" },
];

type Tab = "rides" | "budget" | "trends" | "space";
type Modal = "add" | "edit" | "sign-in" | "create-space" | "join-space" | "share" | "budget" | "shortcut" | null;
type AuthUser = { id: string; email?: string } | null;
type TimeHorizon = "week" | "4weeks" | "3months" | "lifetime";

const money = new Intl.NumberFormat("en-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function getOtherMember(members: Member[], userId: string) {
  return members.find((member) => member.user_id !== userId) ?? null;
}

function getTripMemberSpend(trip: Trip, memberId: string) {
  if (trip.trip_mode === "solo") return trip.solo_by === memberId ? trip.amount : 0;
  return trip.amount / 2;
}

export default function Home() {
  const supabase = getSupabase();
  const previewMode = !supabase && process.env.NODE_ENV !== "production";

  // Tab State - starts fresh on 'rides' on app open
  const [activeTab, setActiveTab] = useState<Tab>("rides");

  const [shortcutPreFill, setShortcutPreFill] = useState<{ amount?: string; mode?: "shared" | "solo"; paidBy?: string } | null>(null);

  useEffect(() => {
    try {
      localStorage.removeItem("ridewise_active_tab");
    } catch {}

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const isShortcut = params.get("shortcut") === "1" || params.get("log") === "1";
      const amt = params.get("amount");
      const mode = params.get("mode") || params.get("trip_mode");
      const paid = params.get("paid_by") || params.get("payer");

      if (isShortcut || amt) {
        setShortcutPreFill({
          amount: amt ?? undefined,
          mode: mode === "solo" ? "solo" : mode === "shared" ? "shared" : undefined,
          paidBy: paid ?? undefined,
        });
        setModal("add");
        const newUrl = window.location.pathname;
        window.history.replaceState({}, "", newUrl);
      }
    }
  }, []);

  // Persistent User, Group, Members, and Trips State
  const [user, setUser] = useState<AuthUser>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = localStorage.getItem("ridewise_cached_user");
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });

  const [group, setGroup] = useState<RideGroup | null>(() => {
    if (previewMode) return demoGroup;
    if (typeof window === "undefined") return null;
    try {
      const saved = localStorage.getItem("ridewise_cached_group");
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });

  const [members, setMembers] = useState<Member[]>(() => {
    if (previewMode) return demoMembers;
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem("ridewise_cached_members");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  const [trips, setTrips] = useState<Trip[]>(() => {
    if (previewMode) return demoTrips;
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem("ridewise_cached_trips");
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  const [modal, setModal] = useState<Modal>(null);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);

  // Rides Feed Filters
  const [ridesFilter, setRidesFilter] = useState<"all" | "unsettled" | "shared" | "solo">("all");

  // Analytics & Scope State
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>("week");
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [weeklyBudget, setWeeklyBudget] = useState<number>(700);
  const [soloScope, setSoloScope] = useState<SoloScope>("mine");
  const [activeDailyBar, setActiveDailyBar] = useState<DailySpendPoint | null>(null);

  // Load saved budget from localStorage on initial render
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ridewise_weekly_budget");
      if (saved && !isNaN(Number(saved)) && Number(saved) > 0) {
        setWeeklyBudget(Number(saved));
      }
    } catch {
      // Ignore in SSR / private mode
    }
  }, []);

  function handleSaveBudget(newBudget: number) {
    setWeeklyBudget(newBudget);
    try {
      localStorage.setItem("ridewise_weekly_budget", String(newBudget));
    } catch {
      // Ignore
    }
    notify(`Weekly budget saved: ${money.format(newBudget)} (${money.format(newBudget / 4)}/college day).`, "success");
  }

  // Accordion Expand/Collapse State for Progressive Disclosure
  const [accordionsOpen, setAccordionsOpen] = useState({
    matrix: false,
    economics: false,
    bus: false,
    insights: false,
  });

  const [toasts, setToasts] = useState<{ id: string; type: "success" | "error" | "info"; message: string }[]>([]);
  const [loading, setLoading] = useState(false);

  function notify(message: string, type: "success" | "error" | "info" = "success") {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  const currentUserId = user?.id ?? "omar";
  const currentName = members.find((member) => member.user_id === currentUserId)?.display_name ?? "Omar";
  const otherMember = getOtherMember(members, currentUserId);

  const lastLoadedUserIdRef = useRef<string | null>(null);

  async function handleAuthSession(sessionUser: { id: string; email?: string } | null) {
    if (!sessionUser) {
      setUser(null);
      setLoading(false);
      lastLoadedUserIdRef.current = null;
      try { localStorage.removeItem("ridewise_cached_user"); } catch {}
      return;
    }
    setUser(sessionUser);
    try { localStorage.setItem("ridewise_cached_user", JSON.stringify(sessionUser)); } catch {}

    const isSameUser = lastLoadedUserIdRef.current === sessionUser.id;
    // Silent background load if same user (stale-while-revalidate), no screen refresh/flicker!
    void loadWorkspace(sessionUser.id, !isSameUser && !group);
  }

  async function loadWorkspace(userId: string, showLoading = false) {
    if (!supabase) return;
    if (showLoading) setLoading(true);
    lastLoadedUserIdRef.current = userId;

    try {
      const membership = await supabase.from("ride_group_members").select("group_id").eq("user_id", userId).limit(1).maybeSingle();
      if (membership.error || !membership.data) {
        setGroup(null);
        setMembers([]);
        setTrips([]);
        return;
      }
      const groupResult = await supabase.from("ride_groups").select("id,name,invite_code").eq("id", membership.data.group_id).single();
      const [membersResult, tripsResult] = await Promise.all([
        supabase.from("ride_group_members").select("user_id,display_name").eq("group_id", membership.data.group_id).order("joined_at"),
        supabase.from("ride_trips").select("id,ride_at,direction,amount,trip_mode,solo_by,paid_by,notes,settled_at,settled_by").eq("group_id", membership.data.group_id).order("ride_at", { ascending: false }),
      ]);
      if (groupResult.data) {
        setGroup(groupResult.data as RideGroup);
        try { localStorage.setItem("ridewise_cached_group", JSON.stringify(groupResult.data)); } catch {}
      }
      const newMembers = (membersResult.data ?? []) as Member[];
      setMembers(newMembers);
      try { localStorage.setItem("ridewise_cached_members", JSON.stringify(newMembers)); } catch {}

      const newTrips = (tripsResult.data ?? []).map((trip) => ({ ...trip, amount: Number(trip.amount) })) as Trip[];
      setTrips(newTrips);
      try { localStorage.setItem("ridewise_cached_trips", JSON.stringify(newTrips)); } catch {}
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!supabase) return;
    const authError = new URLSearchParams(window.location.search).get("error_description");
    if (authError) notify(`Google sign-in failed: ${authError.replace(/\+/g, " ")}`, "error");

    supabase.auth.getSession().then(({ data }) => {
      const sessionUser = data.session?.user;
      void handleAuthSession(sessionUser ? { id: sessionUser.id, email: sessionUser.email } : null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Don't trigger loading on token refresh when switching back to app
      if (event === "TOKEN_REFRESHED" && lastLoadedUserIdRef.current === session?.user?.id) {
        return;
      }
      const sessionUser = session?.user;
      void handleAuthSession(sessionUser ? { id: sessionUser.id, email: sessionUser.email } : null);
    });

    return () => listener.subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const activeTrips = trips.filter((trip) => trip.trip_mode === "shared" && !trip.settled_at);
    const owedToYou = activeTrips.filter((trip) => trip.paid_by === currentUserId).reduce((sum, trip) => sum + trip.amount / 2, 0);
    const youOwe = activeTrips.filter((trip) => trip.paid_by !== currentUserId).reduce((sum, trip) => sum + trip.amount / 2, 0);
    const total = trips.reduce((sum, trip) => sum + trip.amount, 0);
    const toCampus = trips.filter((trip) => trip.direction === "campus").length;
    const toHome = trips.length - toCampus;
    const paidByYou = trips.filter((trip) => trip.paid_by === currentUserId).reduce((sum, trip) => sum + trip.amount, 0);
    const paidByOther = trips.filter((trip) => trip.paid_by !== currentUserId).reduce((sum, trip) => sum + trip.amount, 0);
    const otherMember = getOtherMember(members, currentUserId);
    const personalSpendByYou = trips.reduce((sum, trip) => sum + memberTripSpend(trip, currentUserId), 0);
    const personalSpendByOther = trips.reduce((sum, trip) => sum + (otherMember ? memberTripSpend(trip, otherMember.user_id) : 0), 0);
    const paidByMember = members.map((member) => ({
      ...member,
      total: trips.filter((trip) => trip.paid_by === member.user_id).reduce((sum, trip) => sum + trip.amount, 0),
    }));
    const totalByMember = members.map((member) => ({
      user_id: member.user_id,
      display_name: member.display_name,
      spend: trips.reduce((sum, trip) => sum + getTripMemberSpend(trip, member.user_id), 0),
    }));
    return { owedToYou, youOwe, net: owedToYou - youOwe, total, toCampus, toHome, paidByYou, paidByOther, personalSpendByYou, personalSpendByOther, otherMember, paidByMember, totalByMember };
  }, [trips, members, currentUserId]);

  const recentTrips = useMemo(() => {
    return [...trips].sort((a, b) => +new Date(b.ride_at) - +new Date(a.ride_at));
  }, [trips]);

  const filteredFeedTrips = useMemo(() => {
    return recentTrips.filter((trip) => {
      if (ridesFilter === "unsettled") return trip.trip_mode === "shared" && !trip.settled_at;
      if (ridesFilter === "shared") return trip.trip_mode === "shared";
      if (ridesFilter === "solo") return trip.trip_mode === "solo";
      return true;
    });
  }, [recentTrips, ridesFilter]);

  const sharedTrips = recentTrips.filter((trip) => trip.trip_mode === "shared");
  const unsettledTrips = sharedTrips.filter((trip) => !trip.settled_at);

  const analytics = useMemo(() => {
    const now = new Date();
    const todayIso = toLocalDateKey(now);
    const { start: weekStart, end: weekEnd } = getAcademicWeekBounds(weekOffset, now);

    let horizonStart: Date | null = null;
    let horizonEnd: Date | null = null;
    let horizonLabel = "";

    if (timeHorizon === "week") {
      horizonStart = weekStart;
      horizonEnd = weekEnd;
      const isCurrentWeek = weekOffset === 0;
      const isLastWeek = weekOffset === -1;
      const weekName = isCurrentWeek ? "This week" : isLastWeek ? "Last week" : weekOffset < 0 ? `${Math.abs(weekOffset)}w ago` : `+${weekOffset}w`;
      horizonLabel = `${weekName} (${dateFormatter.format(weekStart)} – ${dateFormatter.format(weekEnd)})`;
    } else if (timeHorizon === "4weeks") {
      horizonStart = new Date(weekEnd.getTime() - (28 * 24 * 60 * 60 * 1000) + 1);
      horizonEnd = weekEnd;
      horizonLabel = `4 Weeks (${dateFormatter.format(horizonStart)} – ${dateFormatter.format(horizonEnd)})`;
    } else if (timeHorizon === "3months") {
      horizonStart = new Date(weekEnd.getTime() - (90 * 24 * 60 * 60 * 1000) + 1);
      horizonEnd = weekEnd;
      horizonLabel = `3 Months (${dateFormatter.format(horizonStart)} – ${dateFormatter.format(horizonEnd)})`;
    } else {
      horizonLabel = "All time";
    }

    const horizonTrips = trips.filter((trip) => {
      const tripDate = new Date(trip.ride_at);
      if (horizonStart && tripDate < horizonStart) return false;
      if (horizonEnd && tripDate > horizonEnd) return false;
      return true;
    });

    const totalSpend = weeklyTotal(horizonTrips);
    const totalRides = horizonTrips.length;
    const avgRideCost = totalRides > 0 ? totalSpend / totalRides : 0;

    // 4-Day Budget Calculations: PER PERSON (half of shared and own solo only)
    const currentWeekTrips = trips.filter((t) => {
      const d = new Date(t.ride_at);
      return d >= weekStart && d <= weekEnd;
    });
    const weekActualSpend = weeklyTotal(currentWeekTrips);
    const personalWeekActualSpend = personalTotal(currentWeekTrips, currentUserId);
    const expectedDailyBudget = dailyBudget(weeklyBudget, EXPECTED_COLLEGE_DAYS);
    const personalWeekCollegeDays = personalCollegeDaysUsed(currentWeekTrips, currentUserId);
    const completedDaysCapped = Math.min(EXPECTED_COLLEGE_DAYS, personalWeekCollegeDays);
    const expectedBudgetUsed = completedDaysCapped * expectedDailyBudget;
    const budgetDiff = budgetDifference(personalWeekActualSpend, expectedBudgetUsed);
    const budgetPct = budgetPercentage(personalWeekActualSpend, expectedBudgetUsed);
    const remainBudget = remainingBudget(weeklyBudget, personalWeekActualSpend);
    const remainCollegeDays = Math.max(0, EXPECTED_COLLEGE_DAYS - completedDaysCapped);
    const remainBudgetPerDay = remainingBudgetPerCollegeDay(remainBudget, completedDaysCapped, EXPECTED_COLLEGE_DAYS);

    let budgetStatus: "under" | "over" | "on" = "on";
    if (completedDaysCapped > 0) {
      if (budgetDiff > 0.5) budgetStatus = "over";
      else if (budgetDiff < -0.5) budgetStatus = "under";
      else budgetStatus = "on";
    }

    // Saturday -> Friday Personal Day-by-Day Breakdown
    const { days: spendingDays, maxSpend: dailyMaxSpend } = computeSpendingByDay(
      trips,
      weekStart,
      expectedDailyBudget,
      todayIso,
      currentUserId
    );

    // 2x2 Matrix Breakdown
    const matrix = compute2x2Matrix(horizonTrips);

    // Solo vs Shared Comparison & Scoped Solo Savings
    const scopedSoloTrips = filterSoloTrips(horizonTrips, soloScope, currentUserId);
    const soloSpendVal = scopedSoloTrips.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const soloRidesCount = scopedSoloTrips.length;
    const soloAvgCost = soloRidesCount > 0 ? soloSpendVal / soloRidesCount : 0;
    const mySoloTrips = filterSoloTrips(horizonTrips, "mine", currentUserId);
    const mySoloSpend = mySoloTrips.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const sharedSpendVal = sharedTotal(horizonTrips);
    const sharedRidesCount = horizonTrips.filter((t) => t.trip_mode === "shared").length;
    const sharedAvgCost = sharedRidesCount > 0 ? sharedSpendVal / sharedRidesCount : 0;
    const sharingSavingsVal = sharedRideSavings(horizonTrips);
    const allTimeSharingSavings = sharedRideSavings(trips);

    // Discrete non-cumulative daily spending series & personal monthly commute average
    const dailySpendingSeries = computeDailySpendingSeries(horizonTrips, currentUserId);
    const personalMonthlyAvg = personalAverageMonthlySpend(trips, currentUserId);
    const dailySpendingAvg = dailySpendingSeries.length > 0
      ? dailySpendingSeries.reduce((s, d) => s + d.amount, 0) / dailySpendingSeries.length
      : 0;

    // Cumulative Spending Trend (fallback / backwards compatibility)
    const spendingTrend = computeSpendingTrend(horizonTrips, currentUserId);

    // Commuter Route Breakdown (Morning Campus vs Evening Home)
    const campusTrips = horizonTrips.filter((t) => t.direction === "campus");
    const homeTrips = horizonTrips.filter((t) => t.direction === "home");
    const campusSpend = campusTrips.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const homeSpend = homeTrips.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const campusSharedCount = campusTrips.filter((t) => t.trip_mode === "shared").length;
    const campusSoloCount = filterSoloTrips(campusTrips, soloScope, currentUserId).length;
    const homeSharedCount = homeTrips.filter((t) => t.trip_mode === "shared").length;
    const homeSoloCount = filterSoloTrips(homeTrips, soloScope, currentUserId).length;

    // EGP 42,000 Bus Benchmark - TOTAL spending shared and solo of everyone vs bus (42,000)
    const totalGroupSpend = trips.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const allTripsSharedTotal = trips.filter((t) => t.trip_mode === "shared").reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const allTripsSoloTotal = trips.filter((t) => t.trip_mode === "solo").reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const busSavingsVal = busBenchmarkSavings(totalGroupSpend, BUS_BENCHMARK);
    const busUsedPctVal = busBenchmarkPercentageUsed(totalGroupSpend, BUS_BENCHMARK);
    const busSavedPctVal = busBenchmarkPercentageSaved(totalGroupSpend, BUS_BENCHMARK);
    const sharedBusUsedPct = (allTripsSharedTotal / BUS_BENCHMARK) * 100;
    const soloBusUsedPct = (allTripsSoloTotal / BUS_BENCHMARK) * 100;
    const personalAllTimeSpend = personalTotal(trips, currentUserId);

    // Monthly Comparison Metrics: current vs expected vs budget limit (weekly * 4)
    const monthlyMetrics = computeMonthlyComparisonMetrics(trips, currentUserId, weeklyBudget, now);

    // Factual Insights
    const allTimeTotalSpend = weeklyTotal(trips);
    const factualInsights = generateFactualInsights({
      actualSpent: personalWeekActualSpend,
      expectedBudgetUsed,
      weeklyBudget,
      usedDays: personalWeekCollegeDays,
      days: spendingDays,
      allTrips: trips,
      totalAllTimeSpend: allTimeTotalSpend,
      sharingSavings: allTimeSharingSavings,
      currencyFormatter: money,
    });

    return {
      horizonLabel,
      weekLabel: `${dateFormatter.format(weekStart)} – ${dateFormatter.format(weekEnd)}`,
      totalSpend,
      totalRides,
      avgRideCost,
      weeklyBudget,
      expectedDailyBudget,
      weekActualSpend,
      personalWeekActualSpend,
      personalWeekCollegeDays,
      completedDaysCapped,
      expectedBudgetUsed,
      budgetDiff,
      budgetPct,
      remainBudget,
      remainCollegeDays,
      remainBudgetPerDay,
      budgetStatus,
      spendingDays,
      dailyMaxSpend,
      matrix,
      soloSpendVal,
      mySoloSpend,
      sharedSpendVal,
      soloRidesCount,
      sharedRidesCount,
      soloAvgCost,
      sharedAvgCost,
      sharingSavingsVal,
      allTimeTotalSpend,
      totalGroupSpend,
      allTripsSharedTotal,
      allTripsSoloTotal,
      personalAllTimeSpend,
      busSavingsVal,
      busUsedPctVal,
      busSavedPctVal,
      soloBusUsedPct,
      sharedBusUsedPct,
      monthlyMetrics,
      factualInsights,
      spendingTrend,
      dailySpendingSeries,
      personalMonthlyAvg,
      dailySpendingAvg,
      campusTrips,
      homeTrips,
      campusSpend,
      homeSpend,
      campusSharedCount,
      campusSoloCount,
      homeSharedCount,
      homeSoloCount,
    };
  }, [trips, timeHorizon, weekOffset, weeklyBudget, currentUserId, soloScope]);

  async function saveTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    const direction = String(form.get("direction")) as Trip["direction"];
    const tripMode = String(form.get("tripMode") || "shared") as Trip["trip_mode"];
    const paidBy = String(form.get("paidBy"));
    const soloBy = tripMode === "solo" ? String(form.get("soloBy") || paidBy) : null;
    const rideAt = String(form.get("rideAt"));
    const notes = String(form.get("notes") ?? "").trim();
    if (!amount || amount <= 0 || !group) return;
    const finalPaidBy = tripMode === "solo" ? soloBy ?? paidBy : paidBy;
    const tripValues = {
      amount,
      direction,
      trip_mode: tripMode,
      solo_by: soloBy,
      paid_by: finalPaidBy,
      ride_at: new Date(rideAt).toISOString(),
      notes: notes || null,
    };
    const tripBeingEdited = editingTrip;

    if (tripBeingEdited) {
      setTrips((existing) => existing.map((trip) => trip.id === tripBeingEdited.id ? { ...trip, ...tripValues } : trip));
      notify("Trip details updated.", "success");
      if (supabase && user) {
        const result = await supabase.from("ride_trips").update(tripValues).eq("id", tripBeingEdited.id);
        if (result.error) notify(`Failed to update trip: ${result.error.message}`, "error");
        await loadWorkspace(user.id, false);
      }
    } else {
      const newTrip = { id: crypto.randomUUID(), ...tripValues, settled_at: null, settled_by: null };
      setTrips((existing) => [newTrip, ...existing]);
      notify("Trip logged. Split calculated.", "success");
      if (supabase && user) {
        const result = await supabase.from("ride_trips").insert({ ...newTrip, group_id: group.id, created_by: user.id });
        if (result.error) notify(`Failed to save trip: ${result.error.message}`, "error");
        await loadWorkspace(user.id, false);
      }
    }
  }

  async function settleTrip(trip: Trip, paidByMemberId?: string) {
    const settledAt = new Date().toISOString();
    setTrips((existing) => existing.map((item) => item.id === trip.id ? { ...item, settled_at: settledAt, settled_by: currentUserId } : item));
    notify("That half is marked settled.", "success");
    if (supabase && user) {
      const result = await supabase.rpc("settle_ride_trip", { target_trip_id: trip.id, settlement_note: null, settlement_paid_by: paidByMemberId ?? currentUserId });
      if (result.error) notify(`Failed to settle trip: ${result.error.message}`, "error");
      await loadWorkspace(user.id, false);
    }
  }

  async function deleteTrip(trip: Trip) {
    if (!window.confirm("Delete this trip?")) return;
    setTrips((existing) => existing.filter((item) => item.id !== trip.id));
    notify("Trip deleted.", "success");
    if (supabase && user) {
      const result = await supabase.from("ride_trips").delete().eq("id", trip.id);
      if (result.error) notify(`Failed to delete trip: ${result.error.message}`, "error");
      await loadWorkspace(user.id, false);
    }
  }

  async function registerPasskey() {
    if (!supabase || !user) return;
    if (!window.PublicKeyCredential) return notify("Passkeys are not supported in this browser.", "error");
    if (!window.isSecureContext) return notify("Passkeys require an HTTPS connection.", "error");
    try {
      const result = await supabase.auth.mfa.webauthn.register({ friendlyName: `Ridewise ${currentName}` });
      if (result.error) {
        const errorText = result.error.message.toLowerCase();
        if (errorText.includes("mfa enroll is disabled") || errorText.includes("mfa_webauthn_enroll_not_enabled")) {
          return notify("Passkeys disabled in Supabase. Enable MFA in settings.", "error");
        }
        return notify(result.error.message, "error");
      }
      notify("Passkey registered on this device!", "success");
    } catch (error) {
      const errorName = error instanceof DOMException ? error.name : "";
      if (errorName === "NotAllowedError") return notify("Passkey setup was cancelled.", "info");
      notify(error instanceof Error ? error.message : "Passkey setup failed.", "error");
    }
  }

  function requestAction(action: Modal) {
    if (supabase && !user) setModal("sign-in");
    else if (supabase && !group && action === "add") setModal("create-space");
    else setModal(action);
  }

  function toggleAccordion(key: keyof typeof accordionsOpen) {
    setAccordionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  if (loading) {
    return (
      <main className="loading-screen">
        <div className="loader" />
        <p>Opening Ridewise</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      {/* Toast Notification Container */}
      {toasts.length > 0 && (
        <div className="toast-portal" role="region" aria-label="Notifications" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-card toast-${toast.type}`}>
              <span className="toast-badge">
                {toast.type === "success" && "✓"}
                {toast.type === "error" && "!"}
                {toast.type === "info" && "i"}
              </span>
              <span className="toast-text">{toast.message}</span>
              <button className="toast-dismiss" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Top App Header */}
      <header className="app-topbar">
        <button className="brand-btn" onClick={() => setActiveTab("rides")}>
          ridewise<span>.</span>
        </button>
        <div className="topbar-actions">
          {group && (
            <button className="space-pill-btn" onClick={() => setActiveTab("space")}>
              <span className="space-pill-dot" />
              <span>{group.name}</span>
            </button>
          )}
          {previewMode && <span className="demo-badge">Preview</span>}
          {supabase && user && (
            <button className="avatar-btn" onClick={() => setActiveTab("space")}>
              {currentName.slice(0, 1)}
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area Based on Active Tab */}
      {!group ? (
        <div className="onboarding-wrap">
          <div className="balance-hero-eyebrow">College Commute Ledger</div>
          <h1>Track every ride.<br />Split fairly.</h1>
          <p>{!supabase ? "Previewing Ridewise with demo data. Connect Supabase to enable sync." : user ? "Create your shared ride space or join Omar's invite." : "Sign in with Google to open your shared ledger."}</p>
          <div className="onboarding-actions">
            {!supabase ? (
              <button className="sheet-submit-btn" onClick={() => setGroup(demoGroup)}>Use Preview Mode</button>
            ) : user ? (
              <>
                <button className="sheet-submit-btn" onClick={() => setModal("create-space")}>Create Space</button>
                <button className="hero-action-btn hero-action-secondary" style={{ color: "var(--ink)", border: "1px solid var(--line)" }} onClick={() => setModal("join-space")}>Join with Code</button>
              </>
            ) : (
              <button className="sheet-submit-btn" onClick={() => setModal("sign-in")}>Sign In with Google</button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* TAB 1: RIDES (Feed & Balance Hero) */}
          {activeTab === "rides" && (
            <main className="tab-content" key="tab-rides">
              {/* Top Hero Balance Card */}
              <section className="balance-hero-card">
                <span className="balance-hero-eyebrow">{group.name}</span>
                <span className="balance-hero-title">
                  {stats.net === 0
                    ? "You’re all square"
                    : stats.net > 0
                    ? `${otherMember?.display_name ?? "Khaled"} owes you`
                    : `You owe ${otherMember?.display_name ?? "Khaled"}`}
                </span>
                <div className="balance-hero-amount">
                  {stats.net === 0 ? "EGP 0.00" : money.format(Math.abs(stats.net))}
                </div>
                <p className="balance-hero-sub">
                  {stats.net === 0 ? "No pending halves right now" : "Across unsettled shared rides"}
                </p>
                <div className="balance-hero-actions">
                  <button className="hero-action-btn hero-action-primary" onClick={() => requestAction("add")}>
                    + Log ride
                  </button>
                  <button
                    type="button"
                    className="hero-action-btn hero-action-secondary"
                    onClick={() => setRidesFilter(ridesFilter === "unsettled" ? "all" : "unsettled")}
                  >
                    {ridesFilter === "unsettled" ? "Show all rides" : `Unsettled (${unsettledTrips.length})`}
                  </button>
                </div>
              </section>

              {/* Top Quick Settlement Strip if pending */}
              {stats.net !== 0 && (
                <div className="rides-settlement-strip">
                  <div className="rides-settlement-info">
                    <span className="rides-settlement-icon">⚖️</span>
                    <span>
                      {stats.net > 0
                        ? `${otherMember?.display_name ?? "Khaled"} owes you ${money.format(stats.net)}`
                        : `You owe ${otherMember?.display_name ?? "Khaled"} ${money.format(Math.abs(stats.net))}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="rides-settlement-btn"
                    onClick={() => setRidesFilter("unsettled")}
                  >
                    Review {unsettledTrips.length} {unsettledTrips.length === 1 ? "ride" : "rides"}
                  </button>
                </div>
              )}

              {/* Feed Filter Chips */}
              <div className="filter-bar">
                <button
                  type="button"
                  className={`filter-chip ${ridesFilter === "all" ? "active" : ""}`}
                  onClick={() => setRidesFilter("all")}
                >
                  All rides ({recentTrips.length})
                </button>
                <button
                  type="button"
                  className={`filter-chip ${ridesFilter === "unsettled" ? "active" : ""}`}
                  onClick={() => setRidesFilter("unsettled")}
                >
                  Unsettled ({unsettledTrips.length})
                </button>
                <button
                  type="button"
                  className={`filter-chip ${ridesFilter === "shared" ? "active" : ""}`}
                  onClick={() => setRidesFilter("shared")}
                >
                  Shared ({sharedTrips.length})
                </button>
                <button
                  type="button"
                  className={`filter-chip ${ridesFilter === "solo" ? "active" : ""}`}
                  onClick={() => setRidesFilter("solo")}
                >
                  Solo ({recentTrips.length - sharedTrips.length})
                </button>
              </div>

              {/* Ride Feed List */}
              <div className="section-header-row">
                <h3 className="section-header-title">Recent rides</h3>
                <span className="section-header-meta">{filteredFeedTrips.length} logged</span>
              </div>

              {filteredFeedTrips.length === 0 ? (
                <div className="empty-feed">
                  <h4>No rides in this view</h4>
                  <p>Tap + below to log your next ride to campus or back home.</p>
                </div>
              ) : (
                <div className="trip-list">
                  {filteredFeedTrips.map((trip) => {
                    const payer = members.find((m) => m.user_id === trip.paid_by)?.display_name ?? "Unknown";
                    const debtorId = members.find((m) => m.user_id !== trip.paid_by)?.user_id;
                    const debtorName = members.find((m) => m.user_id === debtorId)?.display_name ?? "co-pilot";
                    const isCurrentUserDebtor = trip.paid_by !== currentUserId;
                    const soloRider = members.find((m) => m.user_id === trip.solo_by)?.display_name ?? "Solo";

                    return (
                      <article key={trip.id} className="trip-card">
                        <div className="trip-card-main">
                          <div className="trip-card-left">
                            <div className={`trip-direction-badge ${trip.direction}`}>
                              {trip.direction === "campus" ? "🎓" : "🏡"}
                            </div>
                            <div className="trip-card-info">
                              <span className="trip-card-title">
                                {trip.trip_mode === "solo" ? `${soloRider} alone` : trip.direction === "campus" ? "To campus" : "Back home"}
                              </span>
                              <span className="trip-card-meta">
                                {dateTimeFormatter.format(new Date(trip.ride_at))}
                                {trip.notes && ` · ${trip.notes}`}
                              </span>
                            </div>
                          </div>
                          <div className="trip-card-price">
                            <span className="trip-card-amount">{money.format(trip.amount)}</span>
                            <span className="trip-card-split-label">
                              {trip.trip_mode === "solo" ? "full cost" : `${money.format(trip.amount / 2)} each`}
                            </span>
                          </div>
                        </div>
                        <div className="trip-card-footer">
                          <span className="trip-payer-tag">
                            Paid by <b>{payer}</b>
                          </span>
                          <div className="trip-actions">
                            <button
                              type="button"
                              className="trip-action-icon-btn"
                              onClick={() => { setEditingTrip(trip); setModal("edit"); }}
                              title="Edit trip"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="trip-action-icon-btn"
                              style={{ color: "#a84942" }}
                              onClick={() => void deleteTrip(trip)}
                              title="Delete trip"
                            >
                              Delete
                            </button>
                            {trip.settled_at ? (
                              <span className="trip-badge-settled">Settled</span>
                            ) : trip.trip_mode === "solo" ? (
                              <span className="trip-badge-solo">Personal</span>
                            ) : isCurrentUserDebtor ? (
                              <button
                                type="button"
                                className="trip-settle-btn"
                                onClick={() => void settleTrip(trip, currentUserId)}
                              >
                                I paid my half
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="trip-settle-btn"
                                onClick={() => void settleTrip(trip, debtorId)}
                              >
                                Settle {debtorName}
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </main>
          )}

          {/* TAB 2: BUDGET (Weekly College Routine & Pacing) */}
          {activeTab === "budget" && (
            <main className="tab-content" key="tab-budget">
              {/* Academic Week Switcher Bar */}
              <div className="week-switcher-bar">
                <button
                  type="button"
                  className="week-nav-arrow-btn"
                  onClick={() => setWeekOffset((prev) => prev - 1)}
                  aria-label="Previous week"
                >
                  ←
                </button>
                <div className="week-switcher-center">
                  <span className="week-switcher-title">College Week (Sat → Fri)</span>
                  <span className="week-switcher-dates">{analytics.weekLabel}</span>
                  {weekOffset !== 0 && (
                    <button type="button" className="today-jump-btn" onClick={() => setWeekOffset(0)}>
                      Current week
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="week-nav-arrow-btn"
                  onClick={() => setWeekOffset((prev) => prev + 1)}
                  aria-label="Next week"
                >
                  →
                </button>
              </div>

              {/* Hero 4-Day Budget Card: Per Person */}
              <section className="budget-hero-card">
                <div className="budget-hero-top">
                  <div className="budget-hero-title-wrap">
                    <span className="budget-hero-eyebrow">Personal Budget · 4 College Days ({currentName})</span>
                    <h3 className="budget-hero-title">
                      {money.format(analytics.personalWeekActualSpend)}{" "}
                      <span style={{ fontSize: "13px", fontWeight: 400, color: "var(--muted)" }}>
                        your share
                      </span>
                    </h3>
                  </div>
                  <span className={`budget-badge ${analytics.budgetStatus}`}>
                    {analytics.budgetStatus === "under" && `+${Math.abs(analytics.budgetPct).toFixed(0)}% under`}
                    {analytics.budgetStatus === "over" && `${Math.abs(analytics.budgetPct).toFixed(0)}% over`}
                    {analytics.budgetStatus === "on" && "On track"}
                  </span>
                </div>
                <p style={{ margin: "-8px 0 0", fontSize: "11px", color: "var(--muted)", lineHeight: 1.35 }}>
                  Per-person allowance · 50% of shared rides + your own solo rides.
                </p>

                <div className="budget-hero-stats">
                  <div className="budget-stat-block">
                    <span className="budget-stat-label">Daily allowance</span>
                    <span className="budget-stat-val">{money.format(analytics.expectedDailyBudget)}</span>
                    <span className="budget-stat-sub">Based on 4 days/wk</span>
                  </div>
                  <div className="budget-stat-block">
                    <span className="budget-stat-label">Remaining per day</span>
                    <span className="budget-stat-val" style={{ color: "var(--green)" }}>
                      {money.format(analytics.remainBudgetPerDay)}
                    </span>
                    <span className="budget-stat-sub">
                      {analytics.remainCollegeDays} college {analytics.remainCollegeDays === 1 ? "day" : "days"} left
                    </span>
                  </div>
                </div>

                <div className="budget-progress-wrap">
                  <div className="budget-progress-bar">
                    <div
                      className={`budget-progress-fill ${analytics.personalWeekActualSpend > analytics.weeklyBudget ? "over" : ""}`}
                      style={{
                        width: `${Math.min(100, (analytics.personalWeekActualSpend / (analytics.weeklyBudget || 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="budget-progress-labels">
                    <span>{money.format(analytics.personalWeekActualSpend)} of {money.format(analytics.weeklyBudget)}</span>
                    <button
                      type="button"
                      style={{ border: 0, background: "none", color: "var(--green)", fontSize: "11px", fontWeight: 600, padding: 0 }}
                      onClick={() => setModal("budget")}
                    >
                      Edit budget ✎
                    </button>
                  </div>
                </div>

                {/* 1-Tap Quick Budget Presets */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginTop: "12px" }}>
                  <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600 }}>Presets:</span>
                  {[400, 500, 600, 700, 800, 1000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      className={`filter-chip ${weeklyBudget === amt ? "active" : ""}`}
                      style={{ padding: "4px 8px", fontSize: "11px" }}
                      onClick={() => handleSaveBudget(amt)}
                    >
                      {amt}
                    </button>
                  ))}
                </div>
              </section>

              {/* Monthly Commute Projection: Current vs Expected vs Budget Limit */}
              <section className="monthly-runrate-card">
                <div className="section-header-row" style={{ margin: 0 }}>
                  <h4 className="trend-chart-title">Monthly Commute Projection</h4>
                </div>

                {/* Prominent Average Spending Number Display */}
                <div className="monthly-runrate-hero">
                  <div className="monthly-runrate-hero-left">
                    <span className="monthly-runrate-hero-label">Projected Average Monthly Spend</span>
                    <strong className="monthly-runrate-hero-val">{money.format(analytics.monthlyMetrics.expectedMonthlySpend)}</strong>
                    <span className="monthly-runrate-hero-sub">
                      {analytics.monthlyMetrics.loggedDaysCount > 0
                        ? `Avg ${money.format(analytics.monthlyMetrics.averageSpendPerDay)}/day across ${analytics.monthlyMetrics.loggedDaysCount} logged ${analytics.monthlyMetrics.loggedDaysCount === 1 ? "day" : "days"} × 16`
                        : "No logged days yet"}
                    </span>
                  </div>
                </div>

                {/* Progress Bar to Budget Limit with Average Spending Dotted Line Marker */}
                <div className="monthly-progress-wrap">
                  {/* Status text above bar to left */}
                  <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, fontFamily: "DM Mono, monospace", color: analytics.monthlyMetrics.statusColor === "red" ? "var(--red)" : analytics.monthlyMetrics.statusColor === "yellow" ? "#d97706" : "var(--green)" }}>
                      {analytics.monthlyMetrics.statusColor === "green" && "● Within budget"}
                      {analytics.monthlyMetrics.statusColor === "yellow" && "▲ Above expected avg"}
                      {analytics.monthlyMetrics.statusColor === "red" && "■ Near / over limit"}
                    </span>
                  </div>

                  <div className="monthly-progress-track">
                    {/* Current spending fill with dynamic color: green -> yellow after expected -> red near budget */}
                    <div
                      className={`monthly-progress-fill ${analytics.monthlyMetrics.statusColor}`}
                      style={{
                        width: `${Math.min(100, analytics.monthlyMetrics.pctOfLimit)}%`,
                      }}
                    />

                    {/* Dotted Line where the average spending number lies in the progress bar */}
                    {analytics.monthlyMetrics.expectedMonthlySpend > 0 && analytics.monthlyMetrics.monthlyBudgetLimit > 0 && (
                      <div
                        className="monthly-dotted-marker"
                        style={{
                          left: `${Math.min(100, Math.max(0, analytics.monthlyMetrics.pctOfExpectedOnLimit))}%`,
                        }}
                        title={`Expected Monthly Avg: ${money.format(analytics.monthlyMetrics.expectedMonthlySpend)}`}
                      >
                        <div className="monthly-dotted-marker-tag">
                          Avg {money.format(analytics.monthlyMetrics.expectedMonthlySpend)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Below bar: Current spend to left, Budget limit to right */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "var(--muted)", fontFamily: "DM Mono, monospace", marginTop: "4px" }}>
                    <span>
                      Current: <b style={{ color: "var(--ink)" }}>{money.format(analytics.monthlyMetrics.currentMonthSpend)}</b>
                    </span>
                    <span>
                      Limit: <b style={{ color: "var(--ink)" }}>{money.format(analytics.monthlyMetrics.monthlyBudgetLimit)}</b>
                    </span>
                  </div>
                </div>
              </section>

              {/* Bus Benchmark (EGP 42,000) - TOTAL Shared + Solo of Everyone vs Bus */}
              <section className="bus-benchmark-wrap" style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", padding: "16px", boxShadow: "var(--shadow-sm)" }}>
                <div className="bus-benchmark-hero">
                  <span style={{ fontSize: "11px", color: "var(--muted)" }}>University Bus Benchmark (EGP 42,000)</span>
                  <span className="bus-benchmark-num">{money.format(analytics.busSavingsVal)}</span>
                  <small style={{ color: "var(--muted)", fontSize: "11px" }}>
                    {analytics.busSavingsVal >= 0
                      ? `Saved so far vs EGP 42,000 bus pass (Total spend: ${money.format(analytics.totalGroupSpend)})`
                      : `${money.format(Math.abs(analytics.busSavingsVal))} over EGP 42,000 bus pass (Total spend: ${money.format(analytics.totalGroupSpend)})`}
                  </small>
                </div>
                <div className="bus-benchmark-meter">
                  <div className="bus-meter-shared" style={{ width: `${Math.min(100, analytics.sharedBusUsedPct)}%` }} title={`Shared: ${money.format(analytics.allTripsSharedTotal)}`} />
                  <div className="bus-meter-solo" style={{ width: `${Math.min(100 - Math.min(100, analytics.sharedBusUsedPct), analytics.soloBusUsedPct)}%` }} title={`Solo: ${money.format(analytics.allTripsSoloTotal)}`} />
                </div>
                <div className="bus-meter-labels">
                  <span>{analytics.busUsedPctVal.toFixed(1)}% spent ({money.format(analytics.totalGroupSpend)} total shared + solo)</span>
                  <span>{analytics.busSavedPctVal.toFixed(1)}% remaining</span>
                </div>

                {/* Own and other's spending breakdown with percentage of 42,000 */}
                <div className="bus-member-split-section">
                  <span className="bus-member-split-title">Member Payments & Personal Share</span>
                  <div className="bus-member-cards-grid">
                    <div className="bus-member-card">
                      <span className="bus-member-label">You ({currentName})</span>
                      <span className="bus-member-val">{money.format(analytics.personalAllTimeSpend)}</span>
                      <span className="bus-member-sub" style={{ fontFamily: "DM Mono, monospace", fontWeight: 600 }}>
                        {((analytics.personalAllTimeSpend / BUS_BENCHMARK) * 100).toFixed(1)}% of EGP 42,000
                      </span>
                    </div>
                    <div className="bus-member-card">
                      <span className="bus-member-label">{otherMember?.display_name || "Co-pilot"}</span>
                      <span className="bus-member-val">{money.format(stats.personalSpendByOther)}</span>
                      <span className="bus-member-sub" style={{ fontFamily: "DM Mono, monospace", fontWeight: 600 }}>
                        {((stats.personalSpendByOther / BUS_BENCHMARK) * 100).toFixed(1)}% of EGP 42,000
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            </main>
          )}

          {/* TAB 3: TRENDS (Charts, Drawings, Visual Commuter Breakdown & Scope) */}
          {activeTab === "trends" && (
            <main className="tab-content" key="tab-trends">
              {/* Time Horizon Pills */}
              <div className="filter-bar">
                {(["week", "4weeks", "3months", "lifetime"] as TimeHorizon[]).map((hz) => (
                  <button
                    key={hz}
                    type="button"
                    className={`filter-chip ${timeHorizon === hz ? "active" : ""}`}
                    onClick={() => { setTimeHorizon(hz); setActiveDailyBar(null); }}
                  >
                    {hz === "week" ? "This Week" : hz === "4weeks" ? "4 Weeks" : hz === "3months" ? "3 Months" : "All time"}
                  </button>
                ))}
              </div>

              {/* Summary Cards: Total Spent & Shared Only */}
              <div className="analytics-summary-trio">
                <div className="trio-card primary-trio">
                  <span className="trio-label">Total Spent</span>
                  <strong className="trio-value">{money.format(analytics.totalSpend)}</strong>
                  <small className="trio-sub">Shared + Solo ({analytics.totalRides} rides)</small>
                </div>
                <div className="trio-card">
                  <span className="trio-label">Shared Only</span>
                  <strong className="trio-value">{money.format(analytics.sharedSpendVal)}</strong>
                  <small className="trio-sub">{analytics.sharedRidesCount} rides</small>
                </div>
              </div>

              {/* 1. NON-CUMULATIVE DAILY SPENDING BAR CHART */}
              <section className="trend-chart-card">
                <div className="trend-chart-header">
                  <div>
                    <h4 className="trend-chart-title">Daily Commute Spending</h4>
                    <span className="trend-chart-subtitle">Discrete spending per active day (non-cumulative)</span>
                  </div>
                  <div className="trend-chart-stat">
                    <span className="trend-chart-stat-val">{money.format(analytics.dailySpendingAvg)}</span>
                    <span className="trend-chart-stat-sub">Daily active avg</span>
                  </div>
                </div>

                {analytics.dailySpendingSeries.length === 0 ? (
                  <div style={{ height: "120px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: "12px" }}>
                    No rides recorded in this time window.
                  </div>
                ) : (
                  <div className="trend-chart-container">
                    {activeDailyBar && (
                      <div className="trend-tooltip">
                        <span><b>{activeDailyBar.label}</b> ({activeDailyBar.dayName})</span>
                        <span>·</span>
                        <span className="trend-tooltip-val">{money.format(activeDailyBar.amount)}</span>
                        <span>·</span>
                        <span>{activeDailyBar.ridesCount} {activeDailyBar.ridesCount === 1 ? "ride" : "rides"}</span>
                      </div>
                    )}
                    {(() => {
                      const series = analytics.dailySpendingSeries;
                      const maxVal = Math.max(...series.map((p) => p.amount), analytics.dailySpendingAvg * 1.25, 40);
                      const width = 340;
                      const height = 140;
                      const padLeft = 14;
                      const padRight = 14;
                      const padTop = 22;
                      const padBottom = 26;
                      const chartW = width - padLeft - padRight;
                      const chartH = height - padTop - padBottom;
                      const avgY = padTop + chartH - (analytics.dailySpendingAvg / maxVal) * chartH;

                      return (
                        <div className="daily-bar-chart-container">
                          <svg className="daily-bar-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                            <defs>
                              <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#2d6a4f" />
                                <stop offset="100%" stopColor="#40916c" />
                              </linearGradient>
                            </defs>

                            {/* Average baseline */}
                            <line
                              x1={padLeft}
                              y1={avgY}
                              x2={width - padRight}
                              y2={avgY}
                              stroke="#c8c2b4"
                              strokeDasharray="3 3"
                              strokeWidth="1"
                            />
                            <text
                              x={width - padRight}
                              y={Math.max(padTop - 4, avgY - 4)}
                              textAnchor="end"
                              fontSize="8"
                              fontFamily="DM Mono, monospace"
                              fill="#888e84"
                            >
                              avg {Math.round(analytics.dailySpendingAvg)}
                            </text>

                            {/* Bottom baseline */}
                            <line
                              x1={padLeft}
                              y1={padTop + chartH}
                              x2={width - padRight}
                              y2={padTop + chartH}
                              stroke="#ede9df"
                              strokeWidth="1"
                            />

                            {/* Daily Bars */}
                            {series.map((p, idx) => {
                              const barW = Math.min(26, Math.max(12, chartW / series.length - 8));
                              const x = padLeft + (idx + 0.5) * (chartW / series.length) - barW / 2;
                              const barH = Math.max(4, (p.amount / maxVal) * chartH);
                              const y = padTop + chartH - barH;
                              const isSelected = activeDailyBar?.date === p.date;

                              return (
                                <g key={p.date}>
                                  <rect
                                    x={x}
                                    y={y}
                                    width={barW}
                                    height={barH}
                                    rx={4}
                                    className={`daily-chart-bar ${isSelected ? "active" : ""}`}
                                    fill={isSelected ? "var(--lime)" : "url(#barGradient)"}
                                    onClick={() => setActiveDailyBar(isSelected ? null : p)}
                                  />
                                  {/* Day label */}
                                  <text
                                    x={x + barW / 2}
                                    y={height - 8}
                                    textAnchor="middle"
                                    fontSize="9"
                                    fontFamily="DM Mono, monospace"
                                    fill={isSelected ? "var(--green)" : "var(--muted)"}
                                    fontWeight={isSelected ? "800" : "500"}
                                  >
                                    {p.dayName}
                                  </text>
                                  {/* Value label above bar */}
                                  <text
                                    x={x + barW / 2}
                                    y={y - 4}
                                    textAnchor="middle"
                                    fontSize="8"
                                    fontFamily="DM Mono, monospace"
                                    fontWeight="700"
                                    fill={isSelected ? "var(--green)" : "#525950"}
                                  >
                                    {Math.round(p.amount)}
                                  </text>
                                </g>
                              );
                            })}
                          </svg>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </section>

              {/* 2. VISUAL COMMUTER ROUTE DRAWING (Campus vs Home) */}
              <section className="commute-diagram-card">
                <div className="section-header-row" style={{ margin: 0 }}>
                  <h4 className="trend-chart-title">Commute Route Breakdown</h4>
                  <span className="section-header-meta">Direction split</span>
                </div>
                <div className="commute-routes-grid">
                  {/* Route 1: To Campus */}
                  <div className="commute-route-box campus">
                    <div className="commute-route-header">
                      <div className="commute-route-icon">🎓</div>
                      <div>
                        <span className="commute-route-title">Morning to Campus</span>
                        <div className="commute-route-spend">{money.format(analytics.campusSpend)}</div>
                      </div>
                    </div>
                    <div className="commute-route-meta">
                      <span>{analytics.campusTrips.length} rides</span>
                      <span>{analytics.campusTrips.length > 0 ? money.format(analytics.campusSpend / analytics.campusTrips.length) : "0"} avg</span>
                    </div>
                    <div className="commute-split-bar">
                      <div className="commute-split-shared" style={{ width: `${analytics.campusTrips.length > 0 ? (analytics.campusSharedCount / analytics.campusTrips.length) * 100 : 50}%` }} title={`${analytics.campusSharedCount} shared`} />
                      <div className="commute-split-solo" style={{ width: `${analytics.campusTrips.length > 0 ? (analytics.campusSoloCount / analytics.campusTrips.length) * 100 : 50}%` }} title={`${analytics.campusSoloCount} solo`} />
                    </div>
                  </div>

                  {/* Route 2: Back Home */}
                  <div className="commute-route-box home">
                    <div className="commute-route-header">
                      <div className="commute-route-icon">🏡</div>
                      <div>
                        <span className="commute-route-title">Evening Back Home</span>
                        <div className="commute-route-spend">{money.format(analytics.homeSpend)}</div>
                      </div>
                    </div>
                    <div className="commute-route-meta">
                      <span>{analytics.homeTrips.length} rides</span>
                      <span>{analytics.homeTrips.length > 0 ? money.format(analytics.homeSpend / analytics.homeTrips.length) : "0"} avg</span>
                    </div>
                    <div className="commute-split-bar">
                      <div className="commute-split-shared" style={{ width: `${analytics.homeTrips.length > 0 ? (analytics.homeSharedCount / analytics.homeTrips.length) * 100 : 50}%` }} title={`${analytics.homeSharedCount} shared`} />
                      <div className="commute-split-solo" style={{ width: `${analytics.homeTrips.length > 0 ? (analytics.homeSoloCount / analytics.homeTrips.length) * 100 : 50}%` }} title={`${analytics.homeSoloCount} solo`} />
                    </div>
                  </div>
                </div>
              </section>

              {/* 3. SOLO RIDES SCOPE SELECTOR & DEEP DIVE */}
              <section style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", padding: "16px", display: "flex", flexDirection: "column", gap: "10px", boxShadow: "var(--shadow-sm)" }}>
                <div className="solo-scope-wrap">
                  <span className="solo-scope-label">Solo Rides Filter</span>
                  <div className="solo-scope-bar">
                    <button
                      type="button"
                      className={`solo-scope-chip ${soloScope === "mine" ? "active" : ""}`}
                      onClick={() => setSoloScope("mine")}
                    >
                      👤 My solo only
                    </button>
                    <button
                      type="button"
                      className={`solo-scope-chip ${soloScope === "all" ? "active" : ""}`}
                      onClick={() => setSoloScope("all")}
                    >
                      👥 All solo
                    </button>
                    <button
                      type="button"
                      className={`solo-scope-chip ${soloScope === "others" ? "active" : ""}`}
                      onClick={() => setSoloScope("others")}
                    >
                      🤝 Others solo
                    </button>
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: "11px", color: "var(--muted)" }}>
                  {soloScope === "mine" && "Calculating solo rides taken exclusively by you."}
                  {soloScope === "all" && "Calculating all solo rides taken by any member in this group."}
                  {soloScope === "others" && "Calculating solo rides taken by your co-pilot."}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "4px" }}>
                  <div style={{ background: "#fbf9f4", padding: "10px 12px", borderRadius: "8px", border: "1px solid #ede8dc" }}>
                    <span style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600, fontFamily: '"DM Mono", monospace' }}>Spend</span>
                    <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--ink)", marginTop: "2px" }}>{money.format(analytics.soloSpendVal)}</div>
                  </div>
                  <div style={{ background: "#fbf9f4", padding: "10px 12px", borderRadius: "8px", border: "1px solid #ede8dc" }}>
                    <span style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", fontWeight: 600, fontFamily: '"DM Mono", monospace' }}>Rides & Average</span>
                    <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--ink)", marginTop: "2px" }}>
                      {analytics.soloRidesCount} <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--muted)" }}>({money.format(analytics.soloAvgCost)})</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* 5. 2x2 DIRECTION & MODE MATRIX */}
              <section style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", padding: "16px", display: "flex", flexDirection: "column", gap: "10px", boxShadow: "var(--shadow-sm)" }}>
                <div className="section-header-row" style={{ margin: 0 }}>
                  <h4 className="trend-chart-title">Direction & Mode Matrix</h4>
                  <span className="section-header-meta">Campus vs Home × Shared vs Solo</span>
                </div>
                <div className="matrix-mini-grid">
                  <div className="matrix-mini-quadrant">
                    <span className="matrix-quadrant-title">To Campus · Shared</span>
                    <span className="matrix-quadrant-spend">{money.format(analytics.matrix.toCampus.shared.spend)}</span>
                    <span className="matrix-quadrant-meta">{analytics.matrix.toCampus.shared.count} rides</span>
                  </div>
                  <div className="matrix-mini-quadrant">
                    <span className="matrix-quadrant-title">To Campus · Solo</span>
                    <span className="matrix-quadrant-spend">{money.format(analytics.matrix.toCampus.solo.spend)}</span>
                    <span className="matrix-quadrant-meta">{analytics.matrix.toCampus.solo.count} rides</span>
                  </div>
                  <div className="matrix-mini-quadrant">
                    <span className="matrix-quadrant-title">Back Home · Shared</span>
                    <span className="matrix-quadrant-spend">{money.format(analytics.matrix.backHome.shared.spend)}</span>
                    <span className="matrix-quadrant-meta">{analytics.matrix.backHome.shared.count} rides</span>
                  </div>
                  <div className="matrix-mini-quadrant">
                    <span className="matrix-quadrant-title">Back Home · Solo</span>
                    <span className="matrix-quadrant-spend">{money.format(analytics.matrix.backHome.solo.spend)}</span>
                    <span className="matrix-quadrant-meta">{analytics.matrix.backHome.solo.count} rides</span>
                  </div>
                </div>
              </section>

              {/* 6. FACTUAL COMMUTE INSIGHTS */}
              <section style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", padding: "16px", display: "flex", flexDirection: "column", gap: "10px", boxShadow: "var(--shadow-sm)" }}>
                <div className="section-header-row" style={{ margin: 0 }}>
                  <h4 className="trend-chart-title">Smart Routine Insights</h4>
                  <span className="section-header-meta">{analytics.factualInsights.length} observations</span>
                </div>
                <div className="insights-stack">
                  {analytics.factualInsights.map((insight, idx) => (
                    <div key={idx} className="insight-pill">
                      <span className="insight-bullet" />
                      <span>{insight}</span>
                    </div>
                  ))}
                </div>
              </section>
            </main>
          )}

          {/* TAB 4: SPACE (Group Info, Budget, Settings, Auth) */}
          {activeTab === "space" && (
            <main className="tab-content" key="tab-space">
              {/* Settlement Status Card */}
              <section className="split-summary-card">
                <div className="section-header-row">
                  <h3 className="section-header-title">Settlement status</h3>
                  <span className="section-header-meta">50/50 split</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px", padding: "16px", background: "#f8f6f0", borderRadius: "var(--radius-md)", border: "1px solid #ece9df" }}>
                  <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: '"DM Mono", monospace', fontWeight: 600 }}>
                    Net Balance
                  </span>
                  <div style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-1px", color: "var(--ink)" }}>
                    {stats.net === 0
                      ? "All square 🎉"
                      : stats.net > 0
                      ? `${otherMember?.display_name ?? "Khaled"} owes you ${money.format(stats.net)}`
                      : `You owe ${otherMember?.display_name ?? "Khaled"} ${money.format(Math.abs(stats.net))}`}
                  </div>
                  <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                    {stats.net === 0
                      ? "No pending shared rides right now."
                      : `${unsettledTrips.length} unsettled shared ${unsettledTrips.length === 1 ? "ride" : "rides"}.`}
                  </span>
                  {unsettledTrips.length > 0 && (
                    <button
                      type="button"
                      className="sheet-submit-btn"
                      style={{ marginTop: "8px", padding: "8px 14px", fontSize: "12px" }}
                      onClick={() => {
                        setActiveTab("rides");
                        setRidesFilter("unsettled");
                      }}
                    >
                      Review Unsettled Rides in Feed
                    </button>
                  )}
                </div>
              </section>

              <section className="space-card">
                <div className="space-info-group">
                  <span className="balance-hero-eyebrow">Shared Ride Space</span>
                  <h3 className="space-info-title">{group.name}</h3>
                </div>

                <div className="space-code-box">
                  <div>
                    <span style={{ fontSize: "11px", color: "var(--muted)", display: "block" }}>Invite Code</span>
                    <span className="space-code-text">{group.invite_code}</span>
                  </div>
                  <button
                    type="button"
                    className="copy-code-btn"
                    onClick={() => {
                      void navigator.clipboard.writeText(group.invite_code);
                      notify("Invite code copied!", "success");
                    }}
                  >
                    Copy
                  </button>
                </div>
              </section>

              <div className="settings-list">
                <button
                  type="button"
                  className="settings-item-btn"
                  onClick={() => setModal("budget")}
                >
                  <div className="settings-item-title">
                    <span>📅</span>
                    <div>
                      <div>Weekly Budget Routine</div>
                      <span className="settings-item-sub">{money.format(weeklyBudget)}/wk ({money.format(weeklyBudget / 4)}/day across 4 college days)</span>
                    </div>
                  </div>
                  <span style={{ color: "var(--muted)" }}>›</span>
                </button>

                <button
                  type="button"
                  className="settings-item-btn"
                  onClick={() => setModal("shortcut")}
                >
                  <div className="settings-item-title">
                    <span>⚡</span>
                    <div>
                      <div>Add iOS Shortcut</div>
                      <span className="settings-item-sub">Log rides via Siri / Home Screen (Amount, Mode, Payer)</span>
                    </div>
                  </div>
                  <span style={{ color: "var(--muted)" }}>›</span>
                </button>

                {supabase && user && (
                  <button
                    type="button"
                    className="settings-item-btn"
                    onClick={() => void registerPasskey()}
                  >
                    <div className="settings-item-title">
                      <span>🔑</span>
                      <div>
                        <div>Biometric Passkey</div>
                        <span className="settings-item-sub">Fast Face ID / fingerprint sign in</span>
                      </div>
                    </div>
                    <span style={{ color: "var(--muted)" }}>›</span>
                  </button>
                )}

                {supabase && user ? (
                  <button
                    type="button"
                    className="settings-item-btn"
                    onClick={() => {
                      void supabase.auth.signOut();
                      setGroup(null);
                      notify("Signed out.", "info");
                    }}
                  >
                    <div className="settings-item-title" style={{ color: "#a84942" }}>
                      <span>🚪</span>
                      <div>
                        <div>Sign Out</div>
                        <span className="settings-item-sub">{user.email ?? currentName}</span>
                      </div>
                    </div>
                    <span style={{ color: "#a84942" }}>›</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="settings-item-btn"
                    onClick={() => setModal("sign-in")}
                  >
                    <div className="settings-item-title">
                      <span>👤</span>
                      <div>
                        <div>Sign In with Google</div>
                        <span className="settings-item-sub">Access your cloud shared workspace</span>
                      </div>
                    </div>
                    <span style={{ color: "var(--muted)" }}>›</span>
                  </button>
                )}
              </div>
            </main>
          )}
        </>
      )}

      {/* FIXED BOTTOM NAVIGATION BAR */}
      <nav className="bottom-nav-bar" aria-label="Main Navigation">
        <button
          type="button"
          className={`nav-tab-btn ${activeTab === "rides" ? "active" : ""}`}
          onClick={() => setActiveTab("rides")}
        >
          <span className="nav-tab-icon">🚘</span>
          <span className="nav-tab-label">Rides</span>
        </button>

        <button
          type="button"
          className={`nav-tab-btn ${activeTab === "budget" ? "active" : ""}`}
          onClick={() => setActiveTab("budget")}
        >
          <span className="nav-tab-icon">🎯</span>
          <span className="nav-tab-label">Budget</span>
        </button>

        {/* Center Prominent FAB for Logging a Ride Fast */}
        <button
          type="button"
          className="nav-fab-btn"
          onClick={() => requestAction("add")}
          aria-label="Log new ride"
        >
          +
        </button>

        <button
          type="button"
          className={`nav-tab-btn ${activeTab === "trends" ? "active" : ""}`}
          onClick={() => setActiveTab("trends")}
        >
          <span className="nav-tab-icon">📈</span>
          <span className="nav-tab-label">Trends</span>
        </button>

        <button
          type="button"
          className={`nav-tab-btn ${activeTab === "space" ? "active" : ""}`}
          onClick={() => setActiveTab("space")}
        >
          <span className="nav-tab-icon">⚙️</span>
          <span className="nav-tab-label">Space</span>
        </button>
      </nav>

      {/* NATIVE BOTTOM SHEET MODAL */}
      {modal && (
        <BottomSheetWindow
          modal={modal}
          close={() => { setModal(null); setEditingTrip(null); setShortcutPreFill(null); }}
          members={members}
          group={group}
          user={user}
          editingTrip={editingTrip}
          shortcutPreFill={shortcutPreFill}
          supabaseEnabled={Boolean(supabase)}
          notify={notify}
          weeklyBudget={weeklyBudget}
          onSaveBudget={handleSaveBudget}
          onAdd={saveTrip}
          onCreate={async (name, person) => {
            if (!supabase || !user) return;
            const result = await supabase.rpc("create_ride_group", { group_name: name, member_name: person });
            if (result.error) return notify(result.error.message, "error");
            await loadWorkspace(user.id, false);
            setModal("share");
            notify("Shared space created! Invite code ready.", "success");
          }}
          onJoin={async (code, person) => {
            if (!supabase || !user) return;
            const result = await supabase.rpc("join_ride_group", { group_code: code, member_name: person });
            if (result.error) return notify(result.error.message, "error");
            await loadWorkspace(user.id, false);
            setModal(null);
            notify("Joined shared space!", "success");
          }}
          onSignIn={async () => {
            if (!supabase) return;
            const result = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
            if (result.error) return notify(result.error.message, "error");
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NATIVE BOTTOM SHEET COMPONENT (FAST, PRECISE, MOBILE-FIRST)
// ---------------------------------------------------------------------------
function BottomSheetWindow({
  modal,
  close,
  members,
  group,
  user,
  editingTrip,
  shortcutPreFill,
  supabaseEnabled,
  notify,
  weeklyBudget,
  onSaveBudget,
  onAdd,
  onCreate,
  onJoin,
  onSignIn,
}: {
  modal: Exclude<Modal, null>;
  close: () => void;
  members: Member[];
  group: RideGroup | null;
  user: AuthUser;
  editingTrip: Trip | null;
  shortcutPreFill?: { amount?: string; mode?: "shared" | "solo"; paidBy?: string } | null;
  supabaseEnabled: boolean;
  notify: (message: string, type?: "success" | "error" | "info") => void;
  weeklyBudget: number;
  onSaveBudget: (budget: number) => void;
  onAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCreate: (name: string, person: string) => Promise<void>;
  onJoin: (code: string, person: string) => Promise<void>;
  onSignIn: () => Promise<void>;
}) {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const tripDate = editingTrip
    ? new Date(new Date(editingTrip.ride_at).getTime() - new Date(editingTrip.ride_at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    : localTime;

  const matchedPayer = shortcutPreFill?.paidBy
    ? members.find(
        (m) =>
          m.user_id === shortcutPreFill.paidBy ||
          m.display_name.toLowerCase() === shortcutPreFill.paidBy?.toLowerCase()
      )?.user_id
    : undefined;

  const [tripMode, setTripMode] = useState<Trip["trip_mode"]>(
    editingTrip?.trip_mode ?? shortcutPreFill?.mode ?? "shared"
  );
  const [direction, setDirection] = useState<Trip["direction"]>(
    editingTrip?.direction ?? (now.getHours() < 13 ? "campus" : "home")
  );
  const [amount, setAmount] = useState<string>(
    editingTrip ? String(editingTrip.amount) : shortcutPreFill?.amount ? String(shortcutPreFill.amount) : ""
  );
  const [paidBy, setPaidBy] = useState<string>(
    editingTrip?.paid_by ?? matchedPayer ?? user?.id ?? members[0]?.user_id ?? "omar"
  );
  const [soloBy, setSoloBy] = useState<string>(
    editingTrip?.solo_by ?? matchedPayer ?? user?.id ?? members[0]?.user_id ?? "omar"
  );
  const [closing, setClosing] = useState(false);

  function handleClose() {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      close();
    }, 240);
  }

  // Prevent background scroll and page jumps when bottom sheet is open
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  async function handleSubmitRide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (closing) return;
    setClosing(true);
    await onAdd(e);
    setTimeout(() => {
      close();
    }, 240);
  }

  return (
    <div className={`bottom-sheet-backdrop ${closing ? "closing" : ""}`} onClick={handleClose}>
      <div className={`bottom-sheet ${closing ? "closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="bottom-sheet-handle" />

        <div className="bottom-sheet-header">
          <h3 className="bottom-sheet-title">
            {modal === "add" && "Log ride"}
            {modal === "edit" && "Edit ride"}
            {modal === "budget" && "Set weekly budget"}
            {modal === "shortcut" && "iOS Shortcut Setup"}
            {modal === "sign-in" && "Sign in with Google"}
            {modal === "create-space" && "Create shared space"}
            {modal === "join-space" && "Join shared space"}
            {modal === "share" && "Invite co-pilot"}
          </h3>
          <button type="button" className="bottom-sheet-close" onClick={handleClose} aria-label="Close sheet">
            ✕
          </button>
        </div>

        {/* ADD / EDIT RIDE SHEET (ULTRA FAST) */}
        {(modal === "add" || modal === "edit") && (
          <form onSubmit={handleSubmitRide} className="sheet-form">
            {/* Big Tactile Amount Input */}
            <div className="hero-amount-box">
              <div className="hero-amount-wrap">
                <span className="hero-amount-curr">EGP</span>
                <input
                  name="amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="1"
                  required
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="hero-amount-input"
                />
              </div>
              <div className="amount-presets">
                {[60, 90, 110, 125, 150].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="amount-preset-chip"
                    onClick={() => setAmount(String(preset))}
                  >
                    +{preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Direction Segmented Control */}
            <div className="segmented-group">
              <span className="segmented-label">Direction</span>
              <input type="hidden" name="direction" value={direction} />
              <div className="segmented-control">
                <button
                  type="button"
                  className={`segmented-btn ${direction === "campus" ? "active" : ""}`}
                  onClick={() => setDirection("campus")}
                >
                  🎓 To campus
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${direction === "home" ? "active" : ""}`}
                  onClick={() => setDirection("home")}
                >
                  🏡 Back home
                </button>
              </div>
            </div>

            {/* Mode Segmented Control */}
            <div className="segmented-group">
              <span className="segmented-label">Ride Type</span>
              <input type="hidden" name="tripMode" value={tripMode} />
              <div className="segmented-control">
                <button
                  type="button"
                  className={`segmented-btn ${tripMode === "shared" ? "active" : ""}`}
                  onClick={() => setTripMode("shared")}
                >
                  👥 Shared (50/50)
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${tripMode === "solo" ? "active" : ""}`}
                  onClick={() => setTripMode("solo")}
                >
                  👤 Solo (100%)
                </button>
              </div>
            </div>

            {/* Paid By & Solo Rider Pickers */}
            <div style={{ display: "grid", gridTemplateColumns: tripMode === "solo" ? "1fr 1fr" : "1fr", gap: "10px" }}>
              <div className="sheet-field">
                <span className="segmented-label">Paid by</span>
                <select name="paidBy" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
                  ))}
                </select>
              </div>
              {tripMode === "solo" && (
                <div className="sheet-field">
                  <span className="segmented-label">Solo Rider</span>
                  <select name="soloBy" value={soloBy} onChange={(e) => setSoloBy(e.target.value)}>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* When */}
            <div className="sheet-field">
              <span className="segmented-label">When</span>
              <input name="rideAt" type="datetime-local" required defaultValue={tripDate} />
            </div>

            {/* Optional Note */}
            <div className="sheet-field">
              <span className="segmented-label">Note (optional)</span>
              <input name="notes" placeholder="e.g. 8:30 AM lecture, heavy traffic" maxLength={280} defaultValue={editingTrip?.notes ?? ""} />
            </div>

            <button type="submit" className="sheet-submit-btn">
              {editingTrip ? "Update ride" : "Save ride"}
            </button>
          </form>
        )}

        {/* SET WEEKLY BUDGET */}
        {modal === "budget" && (
           <form
             onSubmit={(e) => {
               e.preventDefault();
               const form = new FormData(e.currentTarget);
               const val = Number(form.get("budget"));
               if (val > 0) {
                 onSaveBudget(val);
                 handleClose();
               }
             }}
             className="sheet-form"
           >
             <p style={{ fontSize: "13px", color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.4 }}>
               Divided strictly across <b>4 college days</b> (never 7) to track your daily transportation allowance accurately.
             </p>
             <div className="sheet-field">
               <span className="segmented-label">Weekly Budget (EGP)</span>
               <input name="budget" type="number" inputMode="numeric" min="100" step="50" required defaultValue={weeklyBudget} />
             </div>
             <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
               {[400, 500, 600, 700, 800, 1000].map((preset) => (
                 <button
                   key={preset}
                   type="button"
                   className="amount-preset-chip"
                   onClick={(e) => {
                     const input = e.currentTarget.form?.querySelector<HTMLInputElement>('input[name="budget"]');
                     if (input) input.value = String(preset);
                   }}
                 >
                   {preset} EGP
                 </button>
               ))}
             </div>
             <button type="submit" className="sheet-submit-btn">Save weekly budget</button>
           </form>
        )}

        {/* SIGN IN */}
        {modal === "sign-in" && (
          <div className="sheet-form">
            <p style={{ fontSize: "13px", color: "var(--muted)", margin: 0, lineHeight: 1.4 }}>
              Sign in with your approved Google account to open your shared ride workspace with Khaled.
            </p>
            <button
              type="button"
              className="sheet-submit-btn"
              onClick={() => {
                handleClose();
                void onSignIn();
              }}
            >
              Continue with Google
            </button>
          </div>
        )}

        {/* CREATE SPACE */}
        {modal === "create-space" && (
          <form
            className="sheet-form"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              handleClose();
              void onCreate(String(d.get("space")), String(d.get("name")));
            }}
          >
            <div className="sheet-field">
              <span className="segmented-label">Space Name</span>
              <input name="space" required defaultValue="Omar + Khaled" />
            </div>
            <div className="sheet-field">
              <span className="segmented-label">Your Name</span>
              <input name="name" required defaultValue={user?.email?.split("@")[0] ?? ""} />
            </div>
            <button type="submit" className="sheet-submit-btn">Create shared space</button>
          </form>
        )}

        {/* JOIN SPACE */}
        {modal === "join-space" && (
          <form
            className="sheet-form"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              handleClose();
              void onJoin(String(d.get("code")), String(d.get("name")));
            }}
          >
            <div className="sheet-field">
              <span className="segmented-label">Invite Code</span>
              <input name="code" required placeholder="RIDE2026" />
            </div>
            <div className="sheet-field">
              <span className="segmented-label">Your Name</span>
              <input name="name" required defaultValue={user?.email?.split("@")[0] ?? ""} />
            </div>
            <button type="submit" className="sheet-submit-btn">Join space</button>
          </form>
        )}

        {/* SHARE / INVITE */}
        {modal === "share" && group && (
          <div className="sheet-form">
            <p style={{ fontSize: "13px", color: "var(--muted)", margin: 0 }}>
              Send this invite code to your friend to join your shared ledger.
            </p>
            <div className="space-code-box">
              <span className="space-code-text">{group.invite_code}</span>
              <button
                type="button"
                className="copy-code-btn"
                onClick={() => {
                  void navigator.clipboard.writeText(group.invite_code);
                  notify("Invite code copied to clipboard!", "success");
                }}
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {/* IOS SHORTCUT SETUP */}
        {modal === "shortcut" && (
          <div className="sheet-form" style={{ gap: "16px" }}>
            <div style={{ background: "rgba(37, 99, 235, 0.08)", border: "1px solid rgba(37, 99, 235, 0.2)", borderRadius: "16px", padding: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "6px", color: "var(--foreground)", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>⚡</span> 3 Inputs Required
              </div>
              <p style={{ fontSize: "12px", color: "var(--muted)", margin: "0 0 8px 0", lineHeight: 1.4 }}>
                Your iOS shortcut will ask for these 3 values every commute:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", background: "var(--surface)", padding: "8px 10px", borderRadius: "8px" }}>
                  <span style={{ fontWeight: 700, color: "var(--accent)" }}>1. Amount</span>
                  <span style={{ color: "var(--muted)" }}>— Fare in EGP (Number input, e.g. 120)</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", background: "var(--surface)", padding: "8px 10px", borderRadius: "8px" }}>
                  <span style={{ fontWeight: 700, color: "var(--accent)" }}>2. Shared or Solo</span>
                  <span style={{ color: "var(--muted)" }}>— Choose from menu: Shared or Solo</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", background: "var(--surface)", padding: "8px 10px", borderRadius: "8px" }}>
                  <span style={{ fontWeight: 700, color: "var(--accent)" }}>3. Who Paid</span>
                  <span style={{ color: "var(--muted)" }}>— Choose: {members.map((m) => m.display_name).join(" or ") || "Omar or Khaled"}</span>
                </div>
              </div>
            </div>

            <a
              href="shortcuts://"
              className="sheet-submit-btn"
              style={{ textDecoration: "none", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
            >
              <span>Open Apple Shortcuts App</span>
              <span>↗</span>
            </a>

            {/* Webhook Configuration */}
            <div style={{ background: "var(--surface-container)", borderRadius: "16px", padding: "14px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "4px", color: "var(--foreground)" }}>
                Fast Background Webhook (Siri & Lock Screen)
              </div>
              <p style={{ fontSize: "11px", color: "var(--muted)", margin: "0 0 10px 0", lineHeight: 1.4 }}>
                In Shortcuts, add "Get Contents of URL" to log trips instantly without opening a browser:
              </p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", padding: "6px 10px", borderRadius: "8px", fontSize: "11px" }}>
                  <span style={{ color: "var(--muted)" }}>Method:</span>
                  <strong style={{ color: "var(--accent)" }}>POST</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", padding: "6px 10px", borderRadius: "8px", fontSize: "11px" }}>
                  <span style={{ color: "var(--muted)" }}>URL:</span>
                  <span style={{ fontFamily: "monospace", fontSize: "10px", wordBreak: "break-all" }}>
                    {typeof window !== "undefined" ? `${window.location.origin}/api/trips` : "https://ridewise.vercel.app/api/trips"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", padding: "6px 10px", borderRadius: "8px", fontSize: "11px" }}>
                  <span style={{ color: "var(--muted)" }}>Group Code:</span>
                  <strong style={{ fontFamily: "monospace" }}>{group?.invite_code || "RIDE2026"}</strong>
                </div>
              </div>

              <button
                type="button"
                className="copy-code-btn"
                style={{ width: "100%", marginTop: "10px" }}
                onClick={() => {
                  const samplePayload = {
                    group_code: group?.invite_code || "RIDE2026",
                    amount: 120,
                    trip_mode: "shared",
                    paid_by: members[0]?.display_name || "Omar",
                  };
                  void navigator.clipboard.writeText(JSON.stringify(samplePayload, null, 2));
                  notify("Sample JSON copied to clipboard!", "success");
                }}
              >
                📋 Copy Sample JSON Body
              </button>
            </div>

            {/* Quick Web Link */}
            <div style={{ background: "var(--surface-container)", borderRadius: "16px", padding: "14px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, marginBottom: "4px", color: "var(--foreground)" }}>
                Option 2: Direct App Launcher Link
              </div>
              <p style={{ fontSize: "11px", color: "var(--muted)", margin: "0 0 10px 0", lineHeight: 1.4 }}>
                Or use "Open URLs" in Shortcuts to launch Ridewise with pre-filled inputs:
              </p>
              <button
                type="button"
                className="copy-code-btn"
                style={{ width: "100%" }}
                onClick={() => {
                  const origin = typeof window !== "undefined" ? window.location.origin : "https://ridewise.vercel.app";
                  const sampleUrl = `${origin}/?shortcut=1&amount=120&mode=shared&paid_by=${encodeURIComponent(members[0]?.display_name || "Omar")}`;
                  void navigator.clipboard.writeText(sampleUrl);
                  notify("Launcher URL copied to clipboard!", "success");
                }}
              >
                📋 Copy Shortcut Launcher URL
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
