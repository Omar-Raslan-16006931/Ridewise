"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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
  campusTotal,
  homeTotal,
  busBenchmarkSavings,
  busBenchmarkPercentageUsed,
  busBenchmarkPercentageSaved,
  sharedRideSavings,
  compute2x2Matrix,
  computeSpendingByDay,
  generateFactualInsights,
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

type Modal = "add" | "edit" | "sign-in" | "create-space" | "join-space" | "share" | "budget" | null;
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
  const [user, setUser] = useState<AuthUser>(null);
  const [group, setGroup] = useState<RideGroup | null>(previewMode ? demoGroup : null);
  const [members, setMembers] = useState<Member[]>(previewMode ? demoMembers : []);
  const [trips, setTrips] = useState<Trip[]>(previewMode ? demoTrips : []);
  const [modal, setModal] = useState<Modal>(null);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);

  // Analytics, Week Navigation, Budget & Filters
  const [timeHorizon, setTimeHorizon] = useState<TimeHorizon>("week");
  const [weekOffset, setWeekOffset] = useState<number>(0);
  const [weeklyBudget, setWeeklyBudget] = useState<number>(1500);
  const [customBudgetInput, setCustomBudgetInput] = useState<string>("1500");
  const [filterDirection, setFilterDirection] = useState<"all" | "campus" | "home">("all");
  const [filterMode, setFilterMode] = useState<"all" | "solo" | "shared">("all");
  const [filterRider, setFilterRider] = useState<"all" | string>("all");
  const [selectedDayIso, setSelectedDayIso] = useState<string | null>(null);

  const [toasts, setToasts] = useState<{ id: string; type: "success" | "error" | "info"; message: string }[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));

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

  async function handleAuthSession(sessionUser: { id: string; email?: string } | null) {
    if (!sessionUser) {
      setUser(null);
      setLoading(false);
      return;
    }
    setUser(sessionUser);
    void loadWorkspace(sessionUser.id, true);
  }

  async function loadWorkspace(userId: string, showLoading = false) {
    if (!supabase) return;
    if (showLoading) setLoading(true);
    const membership = await supabase.from("ride_group_members").select("group_id").eq("user_id", userId).limit(1).maybeSingle();
    if (membership.error || !membership.data) {
      setGroup(null);
      setMembers([]);
      setTrips([]);
      setLoading(false);
      return;
    }
    const groupResult = await supabase.from("ride_groups").select("id,name,invite_code").eq("id", membership.data.group_id).single();
    const [membersResult, tripsResult] = await Promise.all([
      supabase.from("ride_group_members").select("user_id,display_name").eq("group_id", membership.data.group_id).order("joined_at"),
      supabase.from("ride_trips").select("id,ride_at,direction,amount,trip_mode,solo_by,paid_by,notes,settled_at,settled_by").eq("group_id", membership.data.group_id).order("ride_at", { ascending: false }),
    ]);
    if (groupResult.data) setGroup(groupResult.data as RideGroup);
    setMembers((membersResult.data ?? []) as Member[]);
    setTrips((tripsResult.data ?? []).map((trip) => ({ ...trip, amount: Number(trip.amount) })) as Trip[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!supabase) return;
    const authError = new URLSearchParams(window.location.search).get("error_description");
    if (authError) notify(`Google sign-in failed: ${authError.replace(/\+/g, " ")}`, "error");
    supabase.auth.getSession().then(({ data }) => {
      const sessionUser = data.session?.user;
      void handleAuthSession(sessionUser ? { id: sessionUser.id, email: sessionUser.email } : null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user;
      void handleAuthSession(sessionUser ? { id: sessionUser.id, email: sessionUser.email } : null);
    });
    return () => listener.subscription.unsubscribe();
  // This client is a module singleton; subscribing once is intentional.
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
    const paidByMember = members.map((member) => ({
      ...member,
      total: trips.filter((trip) => trip.paid_by === member.user_id).reduce((sum, trip) => sum + trip.amount, 0),
    }));
    const totalByMember = members.map((member) => ({
      user_id: member.user_id,
      display_name: member.display_name,
      spend: trips.reduce((sum, trip) => sum + getTripMemberSpend(trip, member.user_id), 0),
    }));
    return { owedToYou, youOwe, net: owedToYou - youOwe, total, toCampus, toHome, paidByYou, paidByMember, totalByMember };
  }, [trips, members, currentUserId]);

  const recentTrips = [...trips].sort((a, b) => +new Date(b.ride_at) - +new Date(a.ride_at));
  const sharedTrips = recentTrips.filter((trip) => trip.trip_mode === "shared");
  const soloTrips = recentTrips.filter((trip) => trip.trip_mode === "solo");
  const sharedTripsTotal = sharedTrips.reduce((sum, trip) => sum + trip.amount, 0);
  const soloTotals = members.map((member) => ({
    ...member,
    rides: soloTrips.filter((trip) => trip.solo_by === member.user_id),
    total: soloTrips.filter((trip) => trip.solo_by === member.user_id).reduce((sum, trip) => sum + trip.amount, 0),
  }));
  const analytics = useMemo(() => {
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);

    // 1. Academic Week bounds for the active weekOffset (Saturday -> Friday)
    const { start: weekStart, end: weekEnd } = getAcademicWeekBounds(weekOffset, now);

    // 2. Horizon boundaries
    let horizonStart: Date | null = null;
    let horizonEnd: Date | null = null;
    let horizonLabel = "";

    if (timeHorizon === "week") {
      horizonStart = weekStart;
      horizonEnd = weekEnd;
      const isCurrentWeek = weekOffset === 0;
      const isLastWeek = weekOffset === -1;
      const weekName = isCurrentWeek ? "This week" : isLastWeek ? "Last week" : weekOffset < 0 ? `${Math.abs(weekOffset)} wks ago` : `+${weekOffset} wks`;
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
      horizonLabel = "All time · Every logged ride";
    }

    // 3. Filter trips by horizon
    const horizonTrips = trips.filter((trip) => {
      const tripDate = new Date(trip.ride_at);
      if (horizonStart && tripDate < horizonStart) return false;
      if (horizonEnd && tripDate > horizonEnd) return false;
      return true;
    });

    // 4. Multi-dimensional filters (direction, type, rider)
    const filteredTrips = horizonTrips.filter((t) => {
      if (filterDirection !== "all" && t.direction !== filterDirection) return false;
      if (filterMode !== "all" && t.trip_mode !== filterMode) return false;
      if (filterRider !== "all") {
        if (t.paid_by !== filterRider && t.solo_by !== filterRider) return false;
      }
      return true;
    });

    // 5. Total and counts in the filtered horizon
    const totalSpend = weeklyTotal(filteredTrips);
    const totalRides = filteredTrips.length;
    const avgRideCost = totalRides > 0 ? totalSpend / totalRides : 0;
    const activeCollegeDays = collegeDaysUsed(filteredTrips);

    // 6. Weekly 4-Day Budget Calculations (based on trips in that academic week)
    const currentWeekTrips = trips.filter((t) => {
      const d = new Date(t.ride_at);
      return d >= weekStart && d <= weekEnd;
    });
    const weekActualSpend = weeklyTotal(currentWeekTrips);
    const expectedDailyBudget = dailyBudget(weeklyBudget, EXPECTED_COLLEGE_DAYS);
    const weekCollegeDays = collegeDaysUsed(currentWeekTrips);
    const completedDaysCapped = Math.min(EXPECTED_COLLEGE_DAYS, weekCollegeDays);
    const expectedBudgetUsed = completedDaysCapped * expectedDailyBudget;
    const budgetDiff = budgetDifference(weekActualSpend, expectedBudgetUsed);
    const budgetPct = budgetPercentage(weekActualSpend, expectedBudgetUsed);
    const remainBudget = remainingBudget(weeklyBudget, weekActualSpend);
    const remainCollegeDays = Math.max(0, EXPECTED_COLLEGE_DAYS - completedDaysCapped);
    const remainBudgetPerDay = remainingBudgetPerCollegeDay(remainBudget, completedDaysCapped, EXPECTED_COLLEGE_DAYS);

    let budgetStatus: "under" | "over" | "on" = "on";
    if (completedDaysCapped > 0) {
      if (budgetDiff > 0.5) budgetStatus = "over";
      else if (budgetDiff < -0.5) budgetStatus = "under";
      else budgetStatus = "on";
    }

    // 7. Saturday -> Friday Day-by-Day Spending Breakdown
    const { days: spendingDays, maxSpend: dailyMaxSpend } = computeSpendingByDay(
      trips,
      weekStart,
      expectedDailyBudget,
      todayIso
    );

    // 8. 2 × 2 Matrix Breakdown
    const matrix = compute2x2Matrix(filteredTrips);

    // 9. Solo vs Shared Comparison & Savings
    const soloSpendVal = soloTotal(filteredTrips);
    const sharedSpendVal = sharedTotal(filteredTrips);
    const soloRidesCount = filteredTrips.filter((t) => t.trip_mode === "solo").length;
    const sharedRidesCount = filteredTrips.filter((t) => t.trip_mode === "shared").length;
    const soloAvgCost = soloRidesCount > 0 ? soloSpendVal / soloRidesCount : 0;
    const sharedAvgCost = sharedRidesCount > 0 ? sharedSpendVal / sharedRidesCount : 0;
    const soloPctOfTotal = totalSpend > 0 ? (soloSpendVal / totalSpend) * 100 : 0;
    const sharedPctOfTotal = totalSpend > 0 ? (sharedSpendVal / totalSpend) * 100 : 0;
    const sharingSavingsVal = sharedRideSavings(filteredTrips);
    const allTimeSharingSavings = sharedRideSavings(trips);

    // 10. EGP 42,000 Bus Benchmark
    const allTimeTotalSpend = weeklyTotal(trips);
    const busSavingsVal = busBenchmarkSavings(allTimeTotalSpend, BUS_BENCHMARK);
    const busUsedPctVal = busBenchmarkPercentageUsed(allTimeTotalSpend, BUS_BENCHMARK);
    const busSavedPctVal = busBenchmarkPercentageSaved(allTimeTotalSpend, BUS_BENCHMARK);

    const allTimeSoloSpend = soloTotal(trips);
    const allTimeSharedSpend = sharedTotal(trips);
    const soloBusUsedPct = busBenchmarkPercentageUsed(allTimeSoloSpend, BUS_BENCHMARK);
    const sharedBusUsedPct = busBenchmarkPercentageUsed(allTimeSharedSpend, BUS_BENCHMARK);
    const soloBusRemaining = BUS_BENCHMARK - allTimeSoloSpend;

    // 11. Factual Insights
    const factualInsights = generateFactualInsights({
      actualSpent: weekActualSpend,
      expectedBudgetUsed,
      weeklyBudget,
      usedDays: weekCollegeDays,
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
      activeCollegeDays,
      // Budget
      weeklyBudget,
      expectedDailyBudget,
      weekActualSpend,
      weekCollegeDays,
      completedDaysCapped,
      expectedBudgetUsed,
      budgetDiff,
      budgetPct,
      remainBudget,
      remainCollegeDays,
      remainBudgetPerDay,
      budgetStatus,
      // Daily breakdown
      spendingDays,
      dailyMaxSpend,
      // Matrix
      matrix,
      // Solo vs Shared
      soloSpendVal,
      sharedSpendVal,
      soloRidesCount,
      sharedRidesCount,
      soloAvgCost,
      sharedAvgCost,
      soloPctOfTotal,
      sharedPctOfTotal,
      sharingSavingsVal,
      // Bus benchmark
      allTimeTotalSpend,
      busSavingsVal,
      busUsedPctVal,
      busSavedPctVal,
      allTimeSoloSpend,
      allTimeSharedSpend,
      soloBusUsedPct,
      sharedBusUsedPct,
      soloBusRemaining,
      // Insights
      factualInsights,
    };
  }, [trips, timeHorizon, weekOffset, weeklyBudget, filterDirection, filterMode, filterRider]);

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
    setModal(null);
    setEditingTrip(null);

    if (tripBeingEdited) {
      setTrips((existing) => existing.map((trip) => trip.id === tripBeingEdited.id ? { ...trip, ...tripValues } : trip));
      notify("Trip details updated.", "success");
      if (supabase && user) {
        const result = await supabase.from("ride_trips").update(tripValues).eq("id", tripBeingEdited.id);
        if (result.error) {
          notify(`Failed to update trip: ${result.error.message}`, "error");
        }
        await loadWorkspace(user.id, false);
      }
    } else {
      const newTrip = { id: crypto.randomUUID(), ...tripValues, settled_at: null, settled_by: null };
      setTrips((existing) => [newTrip, ...existing]);
      notify("Trip saved. The split is ready.", "success");
      if (supabase && user) {
        const result = await supabase.from("ride_trips").insert({ ...newTrip, group_id: group.id, created_by: user.id });
        if (result.error) {
          notify(`Failed to save trip: ${result.error.message}`, "error");
        }
        await loadWorkspace(user.id, false);
      }
    }
  }

  async function settleTrip(trip: Trip, paidByMemberId?: string) {
    const settledAt = new Date().toISOString();
    setTrips((existing) => existing.map((item) => item.id === trip.id ? { ...item, settled_at: settledAt, settled_by: currentUserId } : item));
    notify("That half is marked paid.", "success");
    if (supabase && user) {
      const result = await supabase.rpc("settle_ride_trip", { target_trip_id: trip.id, settlement_note: null, settlement_paid_by: paidByMemberId ?? currentUserId });
      if (result.error) {
        notify(`Failed to settle trip: ${result.error.message}`, "error");
      }
      await loadWorkspace(user.id, false);
    }
  }

  async function deleteTrip(trip: Trip) {
    if (!window.confirm("Delete this trip? This cannot be undone.")) return;
    setTrips((existing) => existing.filter((item) => item.id !== trip.id));
    notify("Trip deleted.", "success");
    if (supabase && user) {
      const result = await supabase.from("ride_trips").delete().eq("id", trip.id);
      if (result.error) {
        notify(`Failed to delete trip: ${result.error.message}`, "error");
      }
      await loadWorkspace(user.id, false);
    }
  }

  async function registerPasskey() {
    if (!supabase || !user) return;
    if (!window.PublicKeyCredential) return notify("Passkeys are not supported in this browser.", "error");
    if (!window.isSecureContext) return notify("Passkeys require a secure HTTPS connection. Open Ridewise from its HTTPS address and try again.", "error");
    try {
      const result = await supabase.auth.mfa.webauthn.register({ friendlyName: `Ridewise ${currentName}` });
      if (result.error) {
        const errorText = result.error.message.toLowerCase();
        if (errorText.includes("mfa enroll is disabled") || errorText.includes("mfa_webauthn_enroll_not_enabled")) {
          return notify("Passkeys are disabled in Supabase. Enable MFA enrollment and Passkey authentication, then try again.", "error");
        }
        return notify(result.error.message, "error");
      }
      notify("Passkey added! You can use it on this device next time.", "success");
    } catch (error) {
      const errorName = error instanceof DOMException ? error.name : "";
      if (errorName === "NotAllowedError") return notify("Passkey setup was cancelled or blocked by the browser.", "info");
      notify(error instanceof Error ? error.message : "Passkey setup failed. Try again from an HTTPS browser.", "error");
    }
  }

  function requestAction(action: Modal) {
    if (supabase && !user) setModal("sign-in");
    else if (supabase && !group && action === "add") setModal("create-space");
    else setModal(action);
  }

  if (loading) return <main className="loading-screen"><div className="loader" /><p>Opening your rides</p></main>;

  return (
    <main>
      {toasts.length > 0 && (
        <div className="toast-portal" role="region" aria-label="Notifications" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-card toast-${toast.type}`}>
              <span className="toast-badge">
                {toast.type === "success" && (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 8.5 6.5 12 13 4" />
                  </svg>
                )}
                {toast.type === "error" && (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="6" />
                    <line x1="8" y1="5" x2="8" y2="8" />
                    <line x1="8" y1="11" x2="8.01" y2="11" />
                  </svg>
                )}
                {toast.type === "info" && (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="6" />
                    <line x1="8" y1="11" x2="8" y2="8" />
                    <line x1="8" y1="5" x2="8.01" y2="5" />
                  </svg>
                )}
              </span>
              <span className="toast-text">{toast.message}</span>
              <button className="toast-dismiss" onClick={() => dismissToast(toast.id)} aria-label="Close notification">×</button>
            </div>
          ))}
        </div>
      )}

      <nav className="topbar">
        <button className="brand" onClick={() => notify("Ridewise — Shared Uber ledger", "info")}>ridewise<span>.</span></button>
        <div className="nav-right">
          {group && <button className="group-switch" onClick={() => requestAction("share")}>{group.name}<i /></button>}
          {supabase && user && <><button className="passkey-button" onClick={() => void registerPasskey()}>Add passkey</button><button className="avatar" onClick={() => { void supabase.auth.signOut(); setGroup(null); notify("Signed out.", "info"); }}>{currentName.slice(0, 1)}</button></>}
          {supabase && !user && <button className="sign-in-button" onClick={() => setModal("sign-in")}>Sign in with Google</button>}
          {previewMode && <span className="demo-tag">Preview</span>}
        </div>
      </nav>

      {!group ? (
        <section className="empty-space">
          <div className="eyebrow">Private shared ride ledger</div>
          <h1>Make every ride<br />feel fair.</h1>
          <p>{!supabase ? "Supabase is not configured for this deployment yet." : user ? "Your Google account is connected. Create the shared space or join Omar's invite." : "Sign in with your approved Google account to open the Omar + Khaled ledger."}</p>
          <div className="empty-actions">{!supabase ? <span className="setup-warning">Add the Supabase environment variables in Vercel to enable login.</span> : user ? <><button className="primary" onClick={() => setModal("create-space")}>Create our space</button><button className="secondary" onClick={() => setModal("join-space")}>Join with a code</button></> : <button className="primary" onClick={() => setModal("sign-in")}>Sign in with Google</button>}</div>
        </section>
      ) : (
        <>
          <section className="summary" onDoubleClick={() => requestAction("add")} aria-label="Ride balance. Double tap to add a ride.">
            <div className="summary-copy">
              <div className="eyebrow">{group.name} · shared rides</div>
              <h1>{stats.net === 0 ? "You’re all square." : stats.net > 0 ? `${otherMember?.display_name ?? "Your friend"} owes you` : `You owe ${otherMember?.display_name ?? "your friend"}`}</h1>
              <p className="balance">{stats.net === 0 ? "No pending halves right now." : money.format(Math.abs(stats.net))}</p>
              <p className="balance-note">{stats.net === 0 ? "Log the next ride when you’re ready." : stats.net > 0 ? "across your unsettled rides" : "across their unsettled rides"}</p>
              <button className="primary add-button" onClick={() => requestAction("add")}><b>+</b> Add a ride</button>
            </div>
          </section>

          <section className="analytics-section" aria-label="College ride analytics and budgeting">
            <div className="analytics-heading">
              <div>
                <div className="eyebrow">College commute analytics · Saturday → Friday</div>
                <h2>Your commute, in context.</h2>
              </div>
            </div>

            {/* 1. Horizon & Week Selector */}
            <div className="horizon-bar">
              <div className="period-tabs" aria-label="Time horizon">
                <button
                  type="button"
                  className={timeHorizon === "week" ? "active" : ""}
                  onClick={() => { setTimeHorizon("week"); setSelectedDayIso(null); }}
                >
                  Weekly view
                </button>
                <button
                  type="button"
                  className={timeHorizon === "4weeks" ? "active" : ""}
                  onClick={() => { setTimeHorizon("4weeks"); setSelectedDayIso(null); }}
                >
                  4 Weeks
                </button>
                <button
                  type="button"
                  className={timeHorizon === "3months" ? "active" : ""}
                  onClick={() => { setTimeHorizon("3months"); setSelectedDayIso(null); }}
                >
                  3 Months
                </button>
                <button
                  type="button"
                  className={timeHorizon === "lifetime" ? "active" : ""}
                  onClick={() => { setTimeHorizon("lifetime"); setSelectedDayIso(null); }}
                >
                  All time
                </button>
              </div>

              {/* Saturday -> Friday Week Navigator */}
              <div className="week-navigator" aria-label="Saturday to Friday week navigation">
                <button
                  type="button"
                  className="week-nav-btn"
                  onClick={() => setWeekOffset((prev) => prev - 1)}
                  title="Previous college week"
                >
                  ← Prev week
                </button>
                <span className="week-label-display">
                  {analytics.weekLabel}
                </span>
                <button
                  type="button"
                  className="week-nav-btn"
                  onClick={() => setWeekOffset((prev) => prev + 1)}
                  title="Next college week"
                >
                  Next week →
                </button>
                {weekOffset !== 0 && (
                  <button
                    type="button"
                    className="week-nav-btn today-btn"
                    onClick={() => setWeekOffset(0)}
                    title="Jump to current week"
                  >
                    Current week
                  </button>
                )}
              </div>
            </div>

            {/* Filter Toolbar */}
            <div className="filter-toolbar" aria-label="Analytics filters">
              <span className="filter-group-label">Direction:</span>
              <div className="filter-pill-group">
                <button
                  type="button"
                  className={`filter-pill ${filterDirection === "all" ? "active" : ""}`}
                  onClick={() => setFilterDirection("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`filter-pill ${filterDirection === "campus" ? "active" : ""}`}
                  onClick={() => setFilterDirection("campus")}
                >
                  To campus
                </button>
                <button
                  type="button"
                  className={`filter-pill ${filterDirection === "home" ? "active" : ""}`}
                  onClick={() => setFilterDirection("home")}
                >
                  Back home
                </button>
              </div>

              <div className="filter-divider" />

              <span className="filter-group-label">Type:</span>
              <div className="filter-pill-group">
                <button
                  type="button"
                  className={`filter-pill ${filterMode === "all" ? "active" : ""}`}
                  onClick={() => setFilterMode("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`filter-pill ${filterMode === "solo" ? "active" : ""}`}
                  onClick={() => setFilterMode("solo")}
                >
                  Solo
                </button>
                <button
                  type="button"
                  className={`filter-pill ${filterMode === "shared" ? "active" : ""}`}
                  onClick={() => setFilterMode("shared")}
                >
                  Shared
                </button>
              </div>

              <div className="filter-divider" />

              <span className="filter-group-label">Rider:</span>
              <div className="filter-pill-group">
                <button
                  type="button"
                  className={`filter-pill ${filterRider === "all" ? "active" : ""}`}
                  onClick={() => setFilterRider("all")}
                >
                  Both
                </button>
                {members.map((m) => (
                  <button
                    key={m.user_id}
                    type="button"
                    className={`filter-pill ${filterRider === m.user_id ? "active" : ""}`}
                    onClick={() => setFilterRider(m.user_id)}
                  >
                    {m.display_name}
                  </button>
                ))}
              </div>
            </div>

            {/* 2 & 6. Primary KPIs */}
            <div className="analytics-kpi-grid">
              <article className="analytics-card analytics-kpi-total">
                <span className="kpi-label">Total spent ({analytics.horizonLabel})</span>
                <strong className="kpi-value">{money.format(analytics.totalSpend)}</strong>
                <small className="kpi-sub">{analytics.totalRides} {analytics.totalRides === 1 ? "ride" : "rides"} across {analytics.activeCollegeDays} {analytics.activeCollegeDays === 1 ? "college day" : "college days"}</small>
              </article>

              <article className="analytics-card">
                <span className="kpi-label">Average ride cost</span>
                <strong className="kpi-value">{money.format(analytics.avgRideCost)}</strong>
                <small className="kpi-sub">per individual Uber trip</small>
              </article>

              <article className="analytics-card">
                <span className="kpi-label">Active college days</span>
                <strong className="kpi-value">{analytics.activeCollegeDays} <small style={{ fontSize: "16px", color: "var(--muted)", fontWeight: "normal" }}>/ 4 target</small></strong>
                <small className="kpi-sub">based on 4-day college routine</small>
              </article>

              <article className="analytics-card">
                <span className="kpi-label">Avg daily commute cost</span>
                <strong className="kpi-value">
                  {analytics.activeCollegeDays > 0 ? money.format(analytics.totalSpend / analytics.activeCollegeDays) : money.format(0)}
                </strong>
                <small className="kpi-sub">true cost per active day</small>
              </article>
            </div>

            {/* 3, 4, 5. Weekly 4-Day Budget System */}
            <div className="budget-banner" aria-label="Weekly transportation budget status">
              <div className="budget-header">
                <div className="budget-title-wrap">
                  <span className="budget-eyebrow">4-DAY WEEKLY TRANSPORTATION BUDGET</span>
                  <h3>{analytics.weekLabel}</h3>
                </div>

                <div className="budget-actions">
                  <span className={`status-badge ${analytics.budgetStatus}`}>
                    {analytics.budgetStatus === "under" && `● UNDER BUDGET · ${Math.abs(analytics.budgetPct).toFixed(0)}% under`}
                    {analytics.budgetStatus === "over" && `▲ OVER BUDGET · ${Math.abs(analytics.budgetPct).toFixed(0)}% over`}
                    {analytics.budgetStatus === "on" && (analytics.weekCollegeDays === 0 ? "READY · 4 college days ahead" : "● ON BUDGET")}
                  </span>
                  <button
                    type="button"
                    className="budget-edit-btn"
                    onClick={() => { setCustomBudgetInput(String(weeklyBudget)); setModal("budget"); }}
                  >
                    Edit budget
                  </button>
                </div>
              </div>

              <div className="budget-stats-grid">
                <div className="budget-stat-item">
                  <span>Weekly budget (4 days)</span>
                  <strong>{money.format(analytics.weeklyBudget)}</strong>
                  <small>{money.format(analytics.expectedDailyBudget)} / college day</small>
                </div>

                <div className="budget-stat-item">
                  <span>Spent this week</span>
                  <strong>{money.format(analytics.weekActualSpend)}</strong>
                  <small>{analytics.completedDaysCapped} of 4 college days completed</small>
                </div>

                <div className="budget-stat-item highlight">
                  <span>Remaining weekly budget</span>
                  <strong style={{ color: analytics.remainBudget >= 0 ? "var(--green)" : "#9c2f24" }}>
                    {money.format(analytics.remainBudget)}
                  </strong>
                  <small>{analytics.remainCollegeDays} college {analytics.remainCollegeDays === 1 ? "day" : "days"} remaining</small>
                </div>

                <div className="budget-stat-item highlight">
                  <span>Remaining per college day</span>
                  <strong style={{ color: analytics.remainBudget >= 0 ? "var(--green)" : "#9c2f24" }}>
                    {money.format(analytics.remainBudgetPerDay)}
                  </strong>
                  <small>dynamically recalculates per day</small>
                </div>
              </div>

              <div className="budget-meter-wrap">
                <div className="budget-meter">
                  <div
                    className={`budget-meter-fill ${analytics.weekActualSpend > analytics.weeklyBudget ? "over" : ""}`}
                    style={{ width: `${analytics.weeklyBudget > 0 ? Math.min(100, (analytics.weekActualSpend / analytics.weeklyBudget) * 100) : 0}%` }}
                  />
                </div>
                <div className="budget-meter-labels">
                  <span>
                    Spent: {money.format(analytics.weekActualSpend)} (expected for {analytics.completedDaysCapped} {analytics.completedDaysCapped === 1 ? "day" : "days"}: {money.format(analytics.expectedBudgetUsed)})
                  </span>
                  <span>
                    {analytics.weeklyBudget > 0 ? ((analytics.weekActualSpend / analytics.weeklyBudget) * 100).toFixed(0) : 0}% of weekly budget
                  </span>
                </div>
              </div>
            </div>

            {/* 7. Spending Saturday -> Friday Chart */}
            <div className="daily-section-card" aria-label="Saturday to Friday daily spending chart">
              <div className="daily-header">
                <div>
                  <span className="card-eyebrow">DAILY COMMUTE SPENDING · SATURDAY → FRIDAY</span>
                  <h3>Spending by Day</h3>
                </div>
                <span className="academic-badge">Target: {money.format(analytics.expectedDailyBudget)} / college day</span>
              </div>

              <div className="pulse-bars" role="group" aria-label="7-day spending chart">
                {analytics.spendingDays.map((day) => {
                  const campusPct = day.actualSpend > 0 ? (day.campusSpend / day.actualSpend) * 100 : 0;
                  const homePct = day.actualSpend > 0 ? (day.homeSpend / day.actualSpend) * 100 : 0;
                  const heightPct = day.actualSpend > 0 ? Math.max(14, Math.round((day.actualSpend / analytics.dailyMaxSpend) * 100)) : 0;
                  const isSelected = selectedDayIso === day.isoDate;

                  return (
                    <button
                      key={day.isoDate}
                      type="button"
                      className={`pulse-col ${day.isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedDayIso((prev) => (prev === day.isoDate ? null : day.isoDate))}
                      title={`${day.dayFullName} (${day.dateStr}): ${money.format(day.actualSpend)} (${day.ridesCount} rides)`}
                    >
                      <div className="pulse-bar-slot">
                        {day.actualSpend > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column-reverse", width: "100%", height: `${heightPct}%` }}>
                            <div className="pulse-segment-campus" style={{ height: `${campusPct}%` }} />
                            <div className="pulse-segment-home" style={{ height: `${homePct}%` }} />
                          </div>
                        ) : (
                          <div className="pulse-zero-marker" />
                        )}
                      </div>
                      <div className="pulse-col-meta">
                        <span className="pulse-day-name">{day.dayName}</span>
                        <span className="pulse-day-num">{day.dayNum}</span>
                        <span className={`pulse-college-indicator ${day.isCollegeDay ? "active" : "rest"}`}>
                          {day.isCollegeDay ? `${money.format(day.actualSpend)}` : "Rest"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedDayIso && (() => {
                const day = analytics.spendingDays.find((d) => d.isoDate === selectedDayIso);
                if (!day) return null;
                const diff = day.actualSpend - analytics.expectedDailyBudget;
                return (
                  <div className="day-inspector">
                    <div>
                      <b>{day.dayFullName}, {day.dateStr}</b>
                      <span> · {day.actualSpend === 0 ? "No college rides logged (Rest day)" : `${money.format(day.actualSpend)} across ${day.ridesCount} ${day.ridesCount === 1 ? "ride" : "rides"}`}</span>
                      {day.actualSpend > 0 && (
                        <span> ({day.campusCount} to Campus: {money.format(day.campusSpend)}, {day.homeCount} Home: {money.format(day.homeSpend)})</span>
                      )}
                      {day.actualSpend > 0 && (
                        <span style={{ marginLeft: "8px", fontWeight: 600, color: diff > 0 ? "#9c2f24" : "var(--green)" }}>
                          ({diff > 0 ? `+${money.format(diff)} above daily budget` : `${money.format(Math.abs(diff))} below daily budget`})
                        </span>
                      )}
                    </div>
                    <button type="button" onClick={() => setSelectedDayIso(null)} title="Dismiss">×</button>
                  </div>
                );
              })()}
            </div>

            {/* 8. 2 × 2 Ride Type Breakdown Matrix */}
            <div className="matrix-card" aria-label="2x2 ride breakdown matrix">
              <span className="card-eyebrow">2 × 2 RIDE TYPE BREAKDOWN MATRIX</span>
              <h3>To Campus vs Back Home × Solo vs Shared</h3>

              <div className="matrix-container">
                {/* To Campus Quadrant */}
                <div className="matrix-quadrant">
                  <div className="matrix-quadrant-header">
                    <span>🏢 TO CAMPUS</span>
                    <span>Total: {money.format(analytics.matrix.toCampus.totalSpend)} ({analytics.matrix.toCampus.totalCount} rides)</span>
                  </div>
                  <div className="matrix-sub-grid">
                    <div className="matrix-cell">
                      <span className="matrix-cell-type">Solo rides</span>
                      <strong className="matrix-cell-spend">{money.format(analytics.matrix.toCampus.solo.spend)}</strong>
                      <span className="matrix-cell-meta">
                        {analytics.matrix.toCampus.solo.count} {analytics.matrix.toCampus.solo.count === 1 ? "ride" : "rides"} · {money.format(analytics.matrix.toCampus.solo.average)} avg
                      </span>
                      <span className="matrix-cell-meta">
                        {analytics.matrix.toCampus.solo.percentage.toFixed(0)}% of period spend
                      </span>
                    </div>

                    <div className="matrix-cell">
                      <span className="matrix-cell-type">Shared (50% split)</span>
                      <strong className="matrix-cell-spend">{money.format(analytics.matrix.toCampus.shared.spend)}</strong>
                      <span className="matrix-cell-meta">
                        {analytics.matrix.toCampus.shared.count} {analytics.matrix.toCampus.shared.count === 1 ? "ride" : "rides"} · {money.format(analytics.matrix.toCampus.shared.average)} avg
                      </span>
                      <span className="matrix-cell-meta">
                        {analytics.matrix.toCampus.shared.percentage.toFixed(0)}% of period spend
                      </span>
                    </div>
                  </div>
                </div>

                {/* Back Home Quadrant */}
                <div className="matrix-quadrant">
                  <div className="matrix-quadrant-header">
                    <span>🏠 BACK HOME</span>
                    <span>Total: {money.format(analytics.matrix.backHome.totalSpend)} ({analytics.matrix.backHome.totalCount} rides)</span>
                  </div>
                  <div className="matrix-sub-grid">
                    <div className="matrix-cell">
                      <span className="matrix-cell-type">Solo rides</span>
                      <strong className="matrix-cell-spend">{money.format(analytics.matrix.backHome.solo.spend)}</strong>
                      <span className="matrix-cell-meta">
                        {analytics.matrix.backHome.solo.count} {analytics.matrix.backHome.solo.count === 1 ? "ride" : "rides"} · {money.format(analytics.matrix.backHome.solo.average)} avg
                      </span>
                      <span className="matrix-cell-meta">
                        {analytics.matrix.backHome.solo.percentage.toFixed(0)}% of period spend
                      </span>
                    </div>

                    <div className="matrix-cell">
                      <span className="matrix-cell-type">Shared (50% split)</span>
                      <strong className="matrix-cell-spend">{money.format(analytics.matrix.backHome.shared.spend)}</strong>
                      <span className="matrix-cell-meta">
                        {analytics.matrix.backHome.shared.count} {analytics.matrix.backHome.shared.count === 1 ? "ride" : "rides"} · {money.format(analytics.matrix.backHome.shared.average)} avg
                      </span>
                      <span className="matrix-cell-meta">
                        {analytics.matrix.backHome.shared.percentage.toFixed(0)}% of period spend
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 9 & 10, 11, 12, 13: Solo vs Shared & Bus Savings Benchmark */}
            <div className="comparison-section-grid">
              {/* Solo vs Shared */}
              <div className="comparison-card">
                <span className="card-eyebrow">SOLO VS SHARED ECONOMICS</span>
                <h3>Ride Mode Comparison</h3>

                <div className="solo-shared-duo">
                  <div className="duo-box">
                    <span className="duo-box-title">👤 Solo spending</span>
                    <strong className="duo-box-spend">{money.format(analytics.soloSpendVal)}</strong>
                    <span className="duo-box-meta">{analytics.soloRidesCount} {analytics.soloRidesCount === 1 ? "ride" : "rides"} · {money.format(analytics.soloAvgCost)} avg</span>
                    <span className="duo-box-meta">{analytics.soloPctOfTotal.toFixed(0)}% of total spend</span>
                  </div>

                  <div className="duo-box">
                    <span className="duo-box-title">👥 Shared spending</span>
                    <strong className="duo-box-spend">{money.format(analytics.sharedSpendVal)}</strong>
                    <span className="duo-box-meta">{analytics.sharedRidesCount} {analytics.sharedRidesCount === 1 ? "ride" : "rides"} · {money.format(analytics.sharedAvgCost)} avg</span>
                    <span className="duo-box-meta">{analytics.sharedPctOfTotal.toFixed(0)}% of total spend</span>
                  </div>
                </div>

                <div className="sharing-savings-callout">
                  <div className="sharing-savings-title">
                    <b>Cumulative sharing savings</b>
                    <strong>{money.format(analytics.sharingSavingsVal)}</strong>
                  </div>
                  <small>
                    Compared with paying the full ride alone (each rider saves 50% on every shared trip).
                  </small>
                </div>
              </div>

              {/* EGP 42,000 Bus Benchmark */}
              <div className="bus-benchmark-card">
                <span className="card-eyebrow">HYPOTHETICAL AVOIDED BUS COST</span>
                <h3>Savings vs Bus Benchmark</h3>

                <div className="benchmark-main-stat">
                  <strong className="benchmark-saved-num">{money.format(analytics.busSavingsVal)}</strong>
                  <span className="benchmark-subtitle">
                    saved compared with EGP 42,000 bus benchmark ({analytics.busSavedPctVal.toFixed(1)}% preserved)
                  </span>
                </div>

                <div className="benchmark-gauge-wrap">
                  <div className="benchmark-gauge">
                    <div
                      className="benchmark-seg-solo"
                      style={{ width: `${analytics.soloBusUsedPct}%` }}
                      title={`Solo: ${money.format(analytics.allTimeSoloSpend)} (${analytics.soloBusUsedPct.toFixed(1)}%)`}
                    />
                    <div
                      className="benchmark-seg-shared"
                      style={{ width: `${analytics.sharedBusUsedPct}%` }}
                      title={`Shared: ${money.format(analytics.allTimeSharedSpend)} (${analytics.sharedBusUsedPct.toFixed(1)}%)`}
                    />
                  </div>
                  <div className="benchmark-gauge-labels">
                    <span>Used: {analytics.busUsedPctVal.toFixed(1)}% ({money.format(analytics.allTimeTotalSpend)})</span>
                    <span>Benchmark: EGP 42,000</span>
                  </div>
                </div>

                <div className="benchmark-breakdown-list">
                  <div className="benchmark-row">
                    <span>Solo spending vs benchmark:</span>
                    <b>{money.format(analytics.allTimeSoloSpend)} ({analytics.soloBusUsedPct.toFixed(1)}%)</b>
                  </div>
                  <div className="benchmark-row">
                    <span>Shared spending vs benchmark:</span>
                    <b>{money.format(analytics.allTimeSharedSpend)} ({analytics.sharedBusUsedPct.toFixed(1)}%)</b>
                  </div>
                  <div className="benchmark-row">
                    <span>Remaining difference vs benchmark:</span>
                    <b>{money.format(analytics.busSavingsVal)}</b>
                  </div>
                </div>
              </div>
            </div>

            {/* 15. Factual Data-Based Insights */}
            <div className="insights-card" aria-label="Calculated insights">
              <div className="insights-header">
                <span style={{ fontSize: "18px" }}>⚡</span>
                <span className="card-eyebrow" style={{ color: "var(--ink)" }}>FACTUAL DATA INSIGHTS</span>
              </div>
              <div className="insights-grid">
                {analytics.factualInsights.map((insight, idx) => (
                  <div className="insight-item" key={idx}>
                    <span className="insight-dot" />
                    <span>{insight}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="ledger-section">
            <div className="section-heading"><div><div className="eyebrow">Shared rides</div><h2>Split between both riders.</h2></div><button className="text-button" onClick={() => requestAction("add")}>New trip</button></div>
            <div className="section-analytics-grid shared-analytics-grid">
              <article className="stat-card total-card">
                <span>Shared total</span>
                <strong>{money.format(sharedTripsTotal)}</strong>
                <small>{sharedTrips.length} {sharedTrips.length === 1 ? "ride" : "rides"} logged</small>
              </article>
              <article className="stat-card">
                <span>Each rider share</span>
                <strong>{money.format(sharedTripsTotal / 2)}</strong>
                <small>50% split per person</small>
              </article>
              {members.map((member) => {
                const memberPaidTrips = sharedTrips.filter((t) => t.paid_by === member.user_id);
                const memberPaidTotal = memberPaidTrips.reduce((sum, t) => sum + t.amount, 0);
                return (
                  <article className="stat-card member-card" key={`shared-paid-${member.user_id}`}>
                    <span>{member.display_name} paid</span>
                    <strong>{money.format(memberPaidTotal)}</strong>
                    <small>{memberPaidTrips.length} {memberPaidTrips.length === 1 ? "ride" : "rides"} upfront</small>
                  </article>
                );
              })}
            </div>
            <div className="ledger">
              {sharedTrips.length === 0 ? <div className="ledger-empty">No shared rides logged yet.</div> : sharedTrips.map((trip) => <TripRow key={trip.id} trip={trip} members={members} currentUserId={currentUserId} onEdit={() => { setEditingTrip(trip); setModal("edit"); }} onSettle={(memberId) => void settleTrip(trip, memberId)} onDelete={() => void deleteTrip(trip)} />)}
            </div>
          </section>

          <section className="ledger-section solo-section">
            <div className="section-heading"><div><div className="eyebrow">Solo rides</div><h2>Full cost, one rider.</h2></div><button className="text-button" onClick={() => requestAction("add")}>New solo ride</button></div>
            <div className="section-analytics-grid solo-analytics-grid">
              <article className="stat-card total-card">
                <span>Solo rides total</span>
                <strong>{money.format(soloTrips.reduce((sum, t) => sum + t.amount, 0))}</strong>
                <small>{soloTrips.length} {soloTrips.length === 1 ? "ride" : "rides"} paid in full</small>
              </article>
              {soloTotals.map((member) => (
                <article className="stat-card member-card" key={`solo-stat-${member.user_id}`}>
                  <span>{member.display_name} alone</span>
                  <strong>{money.format(member.total)}</strong>
                  <small>{member.rides.length} {member.rides.length === 1 ? "ride" : "rides"} · 100% personal</small>
                </article>
              ))}
            </div>
            <div className="ledger">
              {soloTrips.length === 0 ? <div className="ledger-empty">No solo rides logged yet.</div> : soloTrips.map((trip) => <TripRow key={trip.id} trip={trip} members={members} currentUserId={currentUserId} onEdit={() => { setEditingTrip(trip); setModal("edit"); }} onSettle={(memberId) => void settleTrip(trip, memberId)} onDelete={() => void deleteTrip(trip)} />)}
            </div>
          </section>
        </>
      )}

      <footer><span>Ridewise is a shared balance, not a bank.</span><span>Split every Uber equally.</span></footer>
      {modal && <ModalWindow modal={modal} close={() => { setModal(null); setEditingTrip(null); }} members={members} group={group} user={user} editingTrip={editingTrip} supabaseEnabled={Boolean(supabase)} notify={notify} weeklyBudget={weeklyBudget} onSaveBudget={(b) => { setWeeklyBudget(b); notify(`Weekly transportation budget set to ${money.format(b)} (${money.format(b / 4)}/day).`, "success"); }} onAdd={saveTrip} onCreate={async (name, person) => {
        if (!supabase || !user) return;
        const result = await supabase.rpc("create_ride_group", { group_name: name, member_name: person });
        if (result.error) return notify(result.error.message, "error");
        await loadWorkspace(user.id, false);
        setModal("share");
        notify("Shared space created! Invite code ready.", "success");
      }} onJoin={async (code, person) => {
        if (!supabase || !user) return;
        const result = await supabase.rpc("join_ride_group", { group_code: code, member_name: person });
        if (result.error) return notify(result.error.message, "error");
        await loadWorkspace(user.id, false);
        setModal(null);
        notify("Joined shared space successfully!", "success");
      }} onSignIn={async () => {
        if (!supabase) return;
        const result = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
        if (result.error) return notify(result.error.message, "error");
        setModal(null);
      }} />}
    </main>
  );
}

function TripRow({ trip, members, currentUserId, onEdit, onSettle, onDelete }: { trip: Trip; members: Member[]; currentUserId: string; onEdit: () => void; onSettle: (memberId?: string) => void; onDelete: () => void }) {
  const payer = members.find((member) => member.user_id === trip.paid_by)?.display_name ?? "Unknown";
  const debtor = getOtherMember(members, trip.paid_by)?.display_name ?? "The other rider";
  const soloRider = members.find((member) => member.user_id === trip.solo_by)?.display_name ?? "Solo rider";
  const tripLabel = trip.trip_mode === "solo" ? `${soloRider} alone` : trip.direction === "campus" ? "To campus" : "Back home";
  const currentUserIsDebtor = trip.paid_by !== currentUserId;
  const debtorId = members.find((member) => member.user_id !== trip.paid_by)?.user_id;
  const debtorName = members.find((member) => member.user_id === debtorId)?.display_name ?? "the other rider";

  return <article className="trip-row">
    <div className={`trip-direction ${trip.direction}`}><span /><b>{tripLabel}</b><small>{dateTimeFormatter.format(new Date(trip.ride_at))}</small></div>
    <div className="trip-detail"><b>{payer} paid</b><span>{trip.notes || (trip.trip_mode === "solo" ? "Solo ride" : "Uber ride")}</span></div>
    <div className="trip-price"><b>{money.format(trip.amount)}</b><span>{trip.trip_mode === "solo" ? "full cost" : `${money.format(trip.amount / 2)} each`}</span></div>
    <div className="trip-status">
      <button className="edit-button" onClick={onEdit}>Edit</button><button className="delete-button" onClick={onDelete}>Delete</button>
      {trip.settled_at ? <span className="settled">Settled</span> : trip.trip_mode === "solo" ? <span className="waiting">Paid in full</span> : currentUserIsDebtor ? <button className="settle-button" onClick={() => onSettle(currentUserId)}>I paid my half</button> : <button className="settle-button" onClick={() => onSettle(debtorId)}>Mark {debtorName} paid</button>}
    </div>
  </article>;
}

function ModalWindow({ modal, close, members, group, user, editingTrip, supabaseEnabled, notify, weeklyBudget, onSaveBudget, onAdd, onCreate, onJoin, onSignIn }: { modal: Exclude<Modal, null>; close: () => void; members: Member[]; group: RideGroup | null; user: AuthUser; editingTrip: Trip | null; supabaseEnabled: boolean; notify: (message: string, type?: "success" | "error" | "info") => void; weeklyBudget: number; onSaveBudget: (budget: number) => void; onAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>; onCreate: (name: string, person: string) => Promise<void>; onJoin: (code: string, person: string) => Promise<void>; onSignIn: () => Promise<void> }) {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const tripDate = editingTrip ? new Date(new Date(editingTrip.ride_at).getTime() - new Date(editingTrip.ride_at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : localTime;
  const [tripMode, setTripMode] = useState<Trip["trip_mode"]>(editingTrip?.trip_mode ?? "shared");

  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
    <button className="modal-close" aria-label="Close" onClick={close}>×</button>
    {(modal === "add" || modal === "edit") && <><div className="eyebrow">{editingTrip ? "Edit Uber ride" : "New Uber ride"}</div><h2>{editingTrip ? "Update the details." : "Add the details."}</h2><p className="modal-copy">Track shared rides, solo rides, and every total.</p><form onSubmit={onAdd} className="form-stack"><label>Ride cost <div className="amount-field"><span>EGP</span><input name="amount" type="number" inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*" min="1" step="0.01" autoFocus required placeholder="0" defaultValue={editingTrip?.amount} /></div></label><div className="form-columns"><label>Direction<ChoiceButtons name="direction" value={editingTrip?.direction ?? "campus"} options={[{ value: "campus", label: "To campus" }, { value: "home", label: "Back home" }]} /></label><label>Trip type<ChoiceButtons name="tripMode" value={tripMode} onChange={(val) => setTripMode(val as Trip["trip_mode"])} options={[{ value: "shared", label: "Shared" }, { value: "solo", label: "Solo" }]} /></label></div><div className={`form-columns ${tripMode === "solo" ? "two-col" : "single-col"}`}><label>Paid by<ChoiceButtons name="paidBy" value={editingTrip?.paid_by ?? user?.id ?? "omar"} options={members.map((member) => ({ value: member.user_id, label: member.display_name }))} /></label><div className={`solo-rider-animator ${tripMode === "solo" ? "open" : "closed"}`}><label>Solo rider<ChoiceButtons name="soloBy" value={editingTrip?.solo_by ?? user?.id ?? "omar"} options={members.map((member) => ({ value: member.user_id, label: member.display_name }))} /></label></div></div><label>When<input name="rideAt" type="datetime-local" required defaultValue={tripDate} /></label><label>Note <input name="notes" maxLength={280} placeholder="Optional" defaultValue={editingTrip?.notes ?? ""} /></label><button className="primary full" type="submit">{editingTrip ? "Save changes" : "Save trip"}</button></form></>}
    {modal === "budget" && (
      <>
        <div className="eyebrow">4-day college routine</div>
        <h2>Set Weekly Budget</h2>
        <p className="modal-copy">Your weekly budget is divided across <b>4 college days</b> (never 7) to track your daily transportation allowance.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const val = Number(form.get("budget"));
            if (val > 0) {
              onSaveBudget(val);
              close();
            }
          }}
          className="form-stack"
        >
          <label>
            Weekly transportation budget (EGP)
            <div className="amount-field">
              <span>EGP</span>
              <input
                name="budget"
                type="number"
                inputMode="numeric"
                min="100"
                step="50"
                required
                autoFocus
                defaultValue={weeklyBudget}
              />
            </div>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", margin: "4px 0" }}>
            {[1000, 1200, 1500, 1800, 2000, 2400].map((preset) => (
              <button
                key={preset}
                type="button"
                className="choice-button"
                style={{ fontSize: "11px", minHeight: "36px" }}
                onClick={(e) => {
                  const input = e.currentTarget.form?.querySelector<HTMLInputElement>('input[name="budget"]');
                  if (input) input.value = String(preset);
                }}
              >
                {preset} EGP ({preset / 4}/day)
              </button>
            ))}
          </div>
          <button className="primary full" type="submit">Save budget</button>
        </form>
      </>
    )}
    {modal === "sign-in" && <><div className="eyebrow">Private Ridewise space</div><h2>Sign in with Google.</h2><p className="modal-copy">Ridewise is restricted to Omar and Khaled. Use the approved Google account to continue.</p><button className="primary full" onClick={() => void onSignIn()}>Continue with Google</button></>}
    {modal === "create-space" && <><div className="eyebrow">First things first</div><h2>Make your shared space.</h2><p className="modal-copy">You’ll get an invite code to send Khaled when it’s ready.</p><form className="form-stack" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onCreate(String(data.get("space")), String(data.get("name"))); }}><label>Space name<input name="space" autoFocus required defaultValue="Omar + Khaled" /></label><label>Your name<input name="name" required defaultValue={user?.email?.split("@")[0] ?? ""} /></label><button className="primary full" type="submit">Create space</button></form></>}
    {modal === "join-space" && <><div className="eyebrow">Your friend invited you</div><h2>Join the ride ledger.</h2><form className="form-stack" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onJoin(String(data.get("code")), String(data.get("name"))); }}><label>Invite code<input name="code" autoFocus required placeholder="RIDE2026" /></label><label>Your name<input name="name" required defaultValue={user?.email?.split("@")[0] ?? ""} /></label><button className="primary full" type="submit">Join shared space</button></form></>}
    {modal === "share" && group && <><div className="eyebrow">Your shared space is ready</div><h2>Invite your co-pilot.</h2><p className="modal-copy">Send this code to your friend. They sign in, choose “Join with a code,” and both of you will see the same ledger.</p><div className="invite-code">{group.invite_code}</div><button className="primary full" onClick={() => { void navigator.clipboard.writeText(group.invite_code); notify("Invite code copied to clipboard!", "success"); }}>Copy invite code</button><p className="modal-footnote">{supabaseEnabled ? "Only people with this code can join." : "This preview code becomes real after Supabase is connected."}</p></>}
  </section></div>;
}

function ChoiceButtons({ name, value, options, onChange }: { name: string; value: string; options: { value: string; label: string }[]; onChange?: (value: string) => void }) {
  const [selected, setSelected] = useState(value);
  useEffect(() => {
    setSelected(value);
  }, [value]);
  return <div className="choice-buttons"><input type="hidden" name={name} value={selected} />{options.map((option) => <button className={selected === option.value ? "choice-button active" : "choice-button"} key={option.value} type="button" onClick={() => { setSelected(option.value); onChange?.(option.value); }}>{option.label}</button>)}</div>;
}
