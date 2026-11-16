"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "../lib/supabase";
import type { Member, RideGroup, Trip } from "../lib/types";
import { describeTrip } from "../lib/ride-notifications";
import { usePullToRefresh } from "../lib/use-pull-to-refresh";
import {
  isNativeApp,
  getNotificationPermission,
  requestNotificationPermission,
  sendTestNotification,
  syncBackgroundCheck,
  signInWithGoogleNative,
  listenForNativeAuth,
  type NotificationPermission,
} from "../lib/native";
import {
  EXPECTED_COLLEGE_DAYS,
  getAcademicWeekBounds,
  dailyBudget,
  remainingBudget,
  personalTotal,
  computeSpendingByDay,
  toLocalDateKey,
  computeTodayBudget,
  collegeDaysLeft,
  computeMonthlyHistory,
} from "../lib/analytics";
import { buildDemoTrips, demoGroup, demoMembers } from "../lib/demo";
import { egp } from "./ui/format";
import { Icon } from "./ui/icons";
import { TodayTab, type WeekView } from "./ui/TodayTab";
import { RidesTab, type RidesFilter } from "./ui/RidesTab";
import { MonthsTab } from "./ui/MonthsTab";
import { SpaceTab } from "./ui/SpaceTab";
import { Sheet, type SheetKind } from "./ui/Sheet";

type Tab = "today" | "rides" | "months" | "space";
type Modal = SheetKind | null;
type AuthUser = { id: string; email?: string } | null;

const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const money = { format: (value: number) => `EGP ${egp(value)}` };

function getOtherMember(members: Member[], userId: string) {
  return members.find((member) => member.user_id !== userId) ?? null;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "today", label: "Today", icon: "today" },
  { id: "rides", label: "Rides", icon: "rides" },
  { id: "months", label: "Months", icon: "months" },
  { id: "space", label: "Space", icon: "space" },
];

export default function Home() {
  const supabase = getSupabase();
  const previewMode = !supabase && process.env.NODE_ENV !== "production";

  // Tab State - starts fresh on 'rides' on app open
  const [activeTab, setActiveTab] = useState<Tab>("today");

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
    if (previewMode) return buildDemoTrips();
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
  const [ridesFilter, setRidesFilter] = useState<RidesFilter>("all");

  // Analytics & Scope State
  const [weekOffset, setWeekOffset] = useState<number>(0);
  // Which way the week view slides in after a swipe or arrow tap.
  const [weekSlide, setWeekSlide] = useState<"next" | "prev" | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [weeklyBudget, setWeeklyBudget] = useState<number>(700);
  const [hasPasskey, setHasPasskey] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return Boolean(localStorage.getItem("ridewise_passkey_v1"));
    } catch {
      return false;
    }
  });

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
    notify(`Weekly budget saved: ${money.format(newBudget)} (${money.format(newBudget / 4)} per college day).`, "success");
  }

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

  // iOS app: notification permission state, plus what this device has already seen
  // so only rides added elsewhere (auto-logged or by the other rider) are announced.
  const [nativeApp, setNativeApp] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("unsupported");
  const tripsRef = useRef<Trip[]>(trips);
  tripsRef.current = trips;
  const hasLoadedTripsRef = useRef<boolean>(trips.length > 0);
  // Every ride this device has already shown or announced. A ride is announced at most once,
  // even when several refreshes race (app returning to the front fires both a visibility
  // refresh and a Supabase SIGNED_IN event, and both used to announce the same new ride).
  const seenTripIdsRef = useRef<Set<string>>(new Set(trips.map((trip) => trip.id)));
  // Only one workspace load runs at a time; a request made during a load queues one follow-up.
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const loadQueuedRef = useRef<{ userId: string } | null>(null);

  function markTripSeen(tripId: string | null | undefined) {
    if (tripId) seenTripIdsRef.current.add(tripId);
  }

  async function handleAuthSession(sessionUser: { id: string; email?: string } | null) {
    if (!sessionUser) {
      setUser(null);
      setLoading(false);
      lastLoadedUserIdRef.current = null;
      try { localStorage.removeItem("ridewise_cached_user"); } catch {}
      hasLoadedTripsRef.current = false;
      seenTripIdsRef.current = new Set();
      syncBackgroundCheck({ groupCode: "", lastSeen: null });
      return;
    }
    setUser(sessionUser);
    try { localStorage.setItem("ridewise_cached_user", JSON.stringify(sessionUser)); } catch {}

    const isSameUser = lastLoadedUserIdRef.current === sessionUser.id;
    // Silent background load if same user (stale-while-revalidate), no screen refresh/flicker!
    void loadWorkspace(sessionUser.id, !isSameUser && !group);
  }

  async function loadWorkspace(userId: string, showLoading = false): Promise<void> {
    if (!supabase) return;
    if (loadInFlightRef.current) {
      // Another load is running: run once more after it, instead of in parallel.
      loadQueuedRef.current = { userId };
      return loadInFlightRef.current;
    }
    const run = loadWorkspaceOnce(userId, showLoading).finally(() => {
      loadInFlightRef.current = null;
      const queued = loadQueuedRef.current;
      loadQueuedRef.current = null;
      if (queued) void loadWorkspace(queued.userId, false);
    });
    loadInFlightRef.current = run;
    return run;
  }

  async function loadWorkspaceOnce(userId: string, showLoading: boolean) {
    if (!supabase) return;
    if (showLoading) setLoading(true);
    lastLoadedUserIdRef.current = userId;

    try {
      const membership = await supabase.from("ride_group_members").select("group_id").eq("user_id", userId).limit(1).maybeSingle();
      // A failed background refresh (no signal) must not wipe what is already on screen.
      if (membership.error && hasLoadedTripsRef.current) return;
      if (membership.error || !membership.data) {
        setGroup(null);
        setMembers([]);
        setTrips([]);
        return;
      }
      const groupResult = await supabase.from("ride_groups").select("id,name,invite_code").eq("id", membership.data.group_id).single();
      const [membersResult, tripsResult] = await Promise.all([
        supabase.from("ride_group_members").select("user_id,display_name").eq("group_id", membership.data.group_id).order("joined_at"),
        supabase.from("ride_trips").select("id,ride_at,direction,amount,trip_mode,solo_by,paid_by,notes,settled_at,settled_by,created_at").eq("group_id", membership.data.group_id).order("ride_at", { ascending: false }),
      ]);
      if (groupResult.data) {
        setGroup(groupResult.data as RideGroup);
        try { localStorage.setItem("ridewise_cached_group", JSON.stringify(groupResult.data)); } catch {}
      }
      const newMembers = (membersResult.data ?? []) as Member[];
      setMembers(newMembers);
      try { localStorage.setItem("ridewise_cached_members", JSON.stringify(newMembers)); } catch {}

      if (tripsResult.error) return;
      const newTrips = (tripsResult.data ?? []).map((trip) => ({ ...trip, amount: Number(trip.amount) })) as Trip[];

      // Announce rides that appeared from somewhere else (receipt auto-log, Shortcut, the other rider).
      const seen = seenTripIdsRef.current;
      for (const trip of tripsRef.current) seen.add(trip.id);
      const arrivals = newTrips.filter((trip) => !seen.has(trip.id));
      for (const trip of newTrips) seen.add(trip.id);
      if (hasLoadedTripsRef.current && arrivals.length > 0) {
        if (arrivals.length > 3) {
          notify(`${arrivals.length} new rides were added.`, "info");
        } else {
          for (const trip of arrivals) {
            const text = describeTrip(trip, newMembers);
            notify(`${text.title}: ${text.body}`, "info");
          }
        }
      }
      hasLoadedTripsRef.current = true;
      if (groupResult.data) {
        const newestCreatedAt = newTrips.reduce<string | null>(
          (latest, trip) => (trip.created_at && (!latest || new Date(trip.created_at) > new Date(latest)) ? trip.created_at : latest),
          null
        );
        syncBackgroundCheck({ groupCode: (groupResult.data as RideGroup).invite_code, lastSeen: newestCreatedAt });
      }

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

  // iOS app setup: mark the page for native styling and ask for notification permission once signed in.
  useEffect(() => {
    if (!isNativeApp()) return;
    setNativeApp(true);
    document.documentElement.classList.add("native-ios");
    void getNotificationPermission().then(setNotificationPermission);
  }, []);

  useEffect(() => {
    if (!nativeApp || !user || notificationPermission !== "prompt") return;
    void requestNotificationPermission().then(setNotificationPermission);
  }, [nativeApp, user, notificationPermission]);

  // iOS app: finish Google sign-in when the browser sheet hands the session back.
  useEffect(() => {
    if (!supabase) return;
    return listenForNativeAuth(supabase, (error) => {
      if (error) notify(`Google sign-in failed: ${error}`, "error");
      else setModal(null);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pick up rides logged elsewhere: refresh when the app comes back to the front, and every minute while open.
  useEffect(() => {
    if (!supabase || !user) return;
    const userId = user.id;
    let lastRefresh = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRefresh < 15000) return;
      lastRefresh = Date.now();
      void loadWorkspace(userId, false);
    };
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Pick up new deployments: when the app comes back to the front, reload if Vercel is serving a newer build.
  // Keeps the installed iPhone app current after every push, without a new IPA.
  useEffect(() => {
    const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    if (!currentVersion || currentVersion === "dev") return;
    let checking = false;
    const checkForUpdate = async () => {
      if (document.visibilityState !== "visible" || checking) return;
      checking = true;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { version } = (await res.json()) as { version?: string };
        if (version && version !== "dev" && version !== currentVersion) window.location.reload();
      } catch {
        // Offline: keep the current version.
      } finally {
        checking = false;
      }
    };
    document.addEventListener("visibilitychange", checkForUpdate);
    return () => document.removeEventListener("visibilitychange", checkForUpdate);
  }, []);

  function changeWeek(step: number) {
    setWeekSlide(step > 0 ? "next" : "prev");
    setWeekOffset((prev) => (step === 0 ? 0 : prev + step));
  }

  function jumpToCurrentWeek() {
    setWeekSlide(weekOffset > 0 ? "prev" : "next");
    setWeekOffset(0);
  }

  // Swipe left = next week, swipe right = previous week. Ignores mostly-vertical drags (scrolling).
  const weekSwipeHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, select, textarea, .no-swipe")) {
        swipeStartRef.current = null;
        return;
      }
      const t = e.touches[0];
      swipeStartRef.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const start = swipeStartRef.current;
      swipeStartRef.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      changeWeek(dx < 0 ? 1 : -1);
    },
  };

  async function handleNotificationSetup() {
    let permission = notificationPermission;
    if (permission === "prompt") {
      permission = await requestNotificationPermission();
      setNotificationPermission(permission);
    }
    if (permission !== "granted") {
      notify("Notifications are off. Turn them on in iPhone Settings › Ridewise › Notifications.", "error");
      return;
    }
    const sent = await sendTestNotification();
    notify(sent ? "Test notification coming in 6 seconds. Close the app to see it." : "Could not schedule a test notification.", sent ? "info" : "error");
  }

  const [ntfyTesting, setNtfyTesting] = useState(false);

  async function handleNtfyTest() {
    if (!supabase || ntfyTesting) return;
    setNtfyTesting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/notify/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.sent) notify("Test sent. Check the ntfy app on your phone.", "success");
      else notify(result.error || "Could not send the test notification.", "error");
    } catch {
      notify("Could not reach the server. Check your connection.", "error");
    } finally {
      setNtfyTesting(false);
    }
  }

  const stats = useMemo(() => {
    const open = trips.filter((trip) => trip.trip_mode === "shared" && !trip.settled_at);
    const owedToYou = open.filter((trip) => trip.paid_by === currentUserId).reduce((sum, trip) => sum + trip.amount / 2, 0);
    const youOwe = open.filter((trip) => trip.paid_by !== currentUserId).reduce((sum, trip) => sum + trip.amount / 2, 0);
    return { owedToYou, youOwe, net: owedToYou - youOwe };
  }, [trips, currentUserId]);

  const recentTrips = useMemo(() => {
    return [...trips].sort((a, b) => +new Date(b.ride_at) - +new Date(a.ride_at));
  }, [trips]);

  const unsettledTrips = recentTrips.filter((trip) => trip.trip_mode === "shared" && !trip.settled_at);

  // Today's allowance, the week on screen, and every month since the first ride.
  const todayMetrics = useMemo(
    () => computeTodayBudget(trips, currentUserId, weeklyBudget, new Date()),
    [trips, currentUserId, weeklyBudget]
  );

  const week: WeekView = useMemo(() => {
    const now = new Date();
    const { start, end } = getAcademicWeekBounds(weekOffset, now);
    const weekTrips = trips.filter((trip) => {
      const at = new Date(trip.ride_at);
      return at >= start && at <= end;
    });
    const spent = personalTotal(weekTrips, currentUserId);
    const dailyAllowance = dailyBudget(weeklyBudget, EXPECTED_COLLEGE_DAYS);
    const remaining = remainingBudget(weeklyBudget, spent);
    // Days left come from the calendar, so a missed day's money moves onto the days that remain.
    const daysLeft = collegeDaysLeft(start, end, now);
    const { days } = computeSpendingByDay(trips, start, dailyAllowance, toLocalDateKey(now), currentUserId);
    return {
      label: `${dateFormatter.format(start)} – ${dateFormatter.format(end)}`,
      name:
        weekOffset === 0
          ? "This week"
          : weekOffset === -1
          ? "Last week"
          : weekOffset === 1
          ? "Next week"
          : weekOffset < 0
          ? `${Math.abs(weekOffset)} weeks ago`
          : `In ${weekOffset} weeks`,
      spent,
      budget: weeklyBudget,
      remaining,
      daysLeft,
      perDayLeft: daysLeft > 0 ? Math.max(0, remaining) / daysLeft : 0,
      dailyAllowance,
      rides: weekTrips.filter((trip) => trip.trip_mode === "shared" || trip.solo_by === currentUserId).length,
      days,
    };
  }, [trips, weekOffset, weeklyBudget, currentUserId]);

  const months = useMemo(() => computeMonthlyHistory(trips, currentUserId, new Date()), [trips, currentUserId]);

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
    if (!window.PublicKeyCredential) return notify("Passkeys/Face ID are not supported in this browser.", "error");
    if (!window.isSecureContext && window.location.hostname !== "localhost") {
      return notify("Passkeys require an HTTPS connection.", "error");
    }
    if (!user) return notify("Please sign in first before enrolling Face ID.", "info");

    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const userIdBytes = new TextEncoder().encode(user.id);
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: {
            name: "Ridewise",
            ...(isLocalhost ? {} : { id: window.location.hostname }),
          },
          user: {
            id: userIdBytes,
            name: user.email || currentName,
            displayName: currentName || user.email?.split("@")[0] || "Ridewise Rider",
          },
          pubKeyCredParams: [
            { alg: -7, type: "public-key" },  // ES256 (Apple Face ID / Touch ID)
            { alg: -257, type: "public-key" }, // RS256 (Windows Hello)
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "preferred",
            residentKey: "preferred",
          },
          timeout: 60000,
          attestation: "none",
        },
      })) as PublicKeyCredential | null;

      if (!credential) return notify("Passkey setup was cancelled.", "info");

      const secretToken = crypto.randomUUID();

      // Register passkey metadata on backend
      try {
        await fetch("/api/auth/passkey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "register",
            userId: user.id,
            email: user.email,
            credentialId: credential.id,
            secretToken,
          }),
        });
      } catch {
        // Continue saving locally
      }

      const record = {
        credentialId: credential.id,
        userId: user.id,
        userEmail: user.email ?? "",
        userName: currentName,
        secretToken,
        createdAt: new Date().toISOString(),
      };

      try {
        localStorage.setItem("ridewise_passkey_v1", JSON.stringify(record));
        setHasPasskey(true);
      } catch {}

      notify("Face ID / Passkey registered on this device!", "success");
    } catch (error: any) {
      const errorName = error instanceof DOMException ? error.name : error?.name;
      if (errorName === "NotAllowedError") return notify("Passkey setup was cancelled.", "info");
      notify(error instanceof Error ? error.message : "Passkey setup failed.", "error");
    }
  }

  async function verifyPasskey() {
    if (!window.PublicKeyCredential) return notify("Passkeys/Face ID are not supported in this browser.", "error");
    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          ...(isLocalhost ? {} : { rpId: window.location.hostname }),
          timeout: 60000,
          userVerification: "preferred",
        },
      });

      if (assertion) {
        notify("Face ID verified successfully! ✓", "success");
      }
    } catch (error: any) {
      const errorName = error instanceof DOMException ? error.name : error?.name;
      if (errorName === "NotAllowedError") return notify("Biometric prompt was cancelled.", "info");
      notify(error instanceof Error ? error.message : "Biometric verification failed.", "error");
    }
  }

  function removePasskey() {
    if (!window.confirm("Remove Face ID / Passkey from this device?")) return;
    try {
      localStorage.removeItem("ridewise_passkey_v1");
      setHasPasskey(false);
      notify("Passkey removed from this device.", "info");
    } catch {}
  }

  async function signInWithPasskey() {
    if (!window.PublicKeyCredential) return notify("Passkeys/Face ID are not supported in this browser.", "error");
    try {
      const raw = localStorage.getItem("ridewise_passkey_v1");
      if (!raw) return notify("No Face ID profile saved on this device. Please sign in and set up Face ID in Settings.", "error");
      const record = JSON.parse(raw);

      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          ...(isLocalhost ? {} : { rpId: window.location.hostname }),
          timeout: 60000,
          userVerification: "preferred",
        },
      });

      if (!assertion) return;

      notify("Face ID verified! Signing in...", "info");

      const res = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          email: record.userEmail,
          credentialId: record.credentialId,
          secretToken: record.secretToken,
        }),
      });

      const result = await res.json();
      if (!res.ok || result.error || !result.token_hash) {
        throw new Error(result.error || "Failed to authenticate passkey.");
      }

      if (supabase) {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: result.token_hash,
          type: "magiclink",
        });

        if (error || !data.user) {
          throw new Error(error?.message || "Session verification failed.");
        }

        setModal(null);
        await handleAuthSession({ id: data.user.id, email: data.user.email });
        notify(`Welcome back, ${record.userName || "rider"}! Signed in with Face ID.`, "success");
      }
    } catch (error: any) {
      const errorName = error instanceof DOMException ? error.name : error?.name;
      if (errorName === "NotAllowedError") return notify("Face ID sign-in cancelled.", "info");
      notify(error instanceof Error ? error.message : "Face ID sign-in failed.", "error");
    }
  }

  function requestAction(action: Modal) {
    if (supabase && !user) setModal("sign-in");
    else if (supabase && !group && action === "add") setModal("create-space");
    else setModal(action);
  }

  const pull = usePullToRefresh(async () => {
    if (supabase && user) await loadWorkspace(user.id, false);
    else await new Promise((resolve) => setTimeout(resolve, 500));
  }, modal === null && !loading);


  if (loading) {
    return (
      <main className="loading">
        <span className="spinner" aria-hidden="true" />
        <p>Opening Ridewise</p>
      </main>
    );
  }

  const otherName = otherMember?.display_name ?? "your co-rider";
  const rideActions = {
    onEdit: (trip: Trip) => {
      setEditingTrip(trip);
      setModal("edit");
    },
    onDelete: (trip: Trip) => void deleteTrip(trip),
    onSettle: (trip: Trip, paidByMemberId?: string) => void settleTrip(trip, paidByMemberId),
  };
  const showUnsettled = () => {
    setRidesFilter("unsettled");
    setActiveTab("rides");
  };

  return (
    <div className="app">
      {toasts.length > 0 && (
        <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast-${toast.type}`}>
              <Icon name={toast.type === "success" ? "check" : toast.type === "error" ? "x" : "bell"} size={18} />
              <span>{toast.message}</span>
              <button type="button" className="icon-btn" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <header className="topbar">
        <button type="button" className="wordmark" onClick={() => setActiveTab("today")}>
          ridewise
        </button>
        <div className="topbar-side">
          {previewMode && <span className="tag">Preview</span>}
          {group && (
            <button type="button" className="link" onClick={() => setActiveTab("space")}>
              {group.name}
            </button>
          )}
        </div>
      </header>

      {/* Pull-to-refresh indicator (moved directly by the pull hook, outside React renders) */}
      <div ref={pull.indicatorRef} className={`ptr-indicator ${pull.refreshing ? "refreshing" : ""}`} aria-hidden={!pull.refreshing} role="status">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle ref={pull.arcRef} cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        {pull.refreshing && <span className="sr-only">Refreshing</span>}
      </div>

      <div ref={pull.contentRef} className="ptr-content">
        {!group ? (
          <main className="welcome">
            <h1>Every ride, split down the middle.</h1>
            <p>
              {!supabase
                ? "You are looking at Ridewise with sample rides. Connect Supabase to sync a real ledger."
                : user
                ? "Create a shared space for the two of you, or join one with an invite code."
                : "Sign in to open the ledger you share with your co-rider."}
            </p>
            <div className="welcome-actions">
              {!supabase ? (
                <button type="button" className="btn btn-primary btn-wide" onClick={() => setGroup(demoGroup)}>
                  Open the preview
                </button>
              ) : user ? (
                <>
                  <button type="button" className="btn btn-primary btn-wide" onClick={() => setModal("create-space")}>
                    Create a space
                  </button>
                  <button type="button" className="btn btn-quiet btn-wide" onClick={() => setModal("join-space")}>
                    Join with a code
                  </button>
                </>
              ) : (
                <>
                  {hasPasskey && (
                    <button type="button" className="btn btn-primary btn-wide" onClick={() => void signInWithPasskey()}>
                      <Icon name="key" size={18} />
                      Sign in with Face ID
                    </button>
                  )}
                  <button type="button" className={`btn btn-wide ${hasPasskey ? "btn-quiet" : "btn-primary"}`} onClick={() => setModal("sign-in")}>
                    Sign in with Google
                  </button>
                </>
              )}
            </div>
          </main>
        ) : (
          <div key={activeTab} className="tab-wrap">
            {activeTab === "today" && (
              <TodayTab
                net={stats.net}
                unsettledCount={unsettledTrips.length}
                otherName={otherName}
                today={todayMetrics}
                week={week}
                weekOffset={weekOffset}
                weekSlide={weekSlide}
                onChangeWeek={changeWeek}
                onThisWeek={jumpToCurrentWeek}
                swipeHandlers={weekSwipeHandlers}
                latest={recentTrips.slice(0, 4)}
                totalRides={recentTrips.length}
                members={members}
                currentUserId={currentUserId}
                rideActions={rideActions}
                onLog={() => requestAction("add")}
                onSettleUp={showUnsettled}
                onSeeAll={() => {
                  setRidesFilter("all");
                  setActiveTab("rides");
                }}
                onEditBudget={() => setModal("budget")}
              />
            )}
            {activeTab === "rides" && (
              <RidesTab
                trips={recentTrips}
                filter={ridesFilter}
                onFilter={setRidesFilter}
                members={members}
                currentUserId={currentUserId}
                rideActions={rideActions}
                onLog={() => requestAction("add")}
              />
            )}
            {activeTab === "months" && (
              <MonthsTab
                months={months}
                trips={trips}
                weeklyBudget={weeklyBudget}
                members={members}
                currentUserId={currentUserId}
                otherName={otherName}
                otherId={otherMember?.user_id ?? null}
                rideActions={rideActions}
                onEditBudget={() => setModal("budget")}
              />
            )}
            {activeTab === "space" && (
              <SpaceTab
                group={group}
                members={members}
                currentName={currentName}
                email={user?.email}
                net={stats.net}
                otherName={otherName}
                unsettledCount={unsettledTrips.length}
                weeklyBudget={weeklyBudget}
                signedIn={Boolean(user)}
                cloud={Boolean(supabase)}
                nativeApp={nativeApp}
                notificationPermission={notificationPermission}
                hasPasskey={hasPasskey}
                ntfyTesting={ntfyTesting}
                onReviewUnsettled={showUnsettled}
                onCopyCode={() => {
                  void navigator.clipboard.writeText(group.invite_code);
                  notify("Invite code copied.", "success");
                }}
                onBudget={() => setModal("budget")}
                onShortcut={() => setModal("shortcut")}
                onNotifications={() => void handleNotificationSetup()}
                onNtfyTest={() => void handleNtfyTest()}
                onPasskey={() => void (hasPasskey ? verifyPasskey() : registerPasskey())}
                onRemovePasskey={removePasskey}
                onSignOut={() => {
                  void supabase?.auth.signOut();
                  setGroup(null);
                  notify("Signed out.", "info");
                }}
                onSignIn={() => setModal("sign-in")}
              />
            )}
          </div>
        )}
      </div>

      {group && (
        <nav className="nav" aria-label="Main">
          {TABS.slice(0, 2).map((tab) => (
            <button key={tab.id} type="button" className={`nav-tab ${activeTab === tab.id ? "is-on" : ""}`} aria-current={activeTab === tab.id ? "page" : undefined} onClick={() => setActiveTab(tab.id)}>
              <Icon name={tab.icon} size={24} />
              <span>{tab.label}</span>
            </button>
          ))}
          <button type="button" className="nav-tab nav-log" onClick={() => requestAction("add")}>
            <Icon name="plus" size={28} />
            <span>Log ride</span>
          </button>
          {TABS.slice(2).map((tab) => (
            <button key={tab.id} type="button" className={`nav-tab ${activeTab === tab.id ? "is-on" : ""}`} aria-current={activeTab === tab.id ? "page" : undefined} onClick={() => setActiveTab(tab.id)}>
              <Icon name={tab.icon} size={24} />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      )}

      {modal && (
        <Sheet
          kind={modal}
          close={() => {
            setModal(null);
            setEditingTrip(null);
            setShortcutPreFill(null);
          }}
          members={members}
          group={group}
          user={user}
          editingTrip={editingTrip}
          prefill={shortcutPreFill}
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
            notify("Space created. Your invite code is ready.", "success");
          }}
          onJoin={async (code, person) => {
            if (!supabase || !user) return;
            const result = await supabase.rpc("join_ride_group", { group_code: code, member_name: person });
            if (result.error) return notify(result.error.message, "error");
            await loadWorkspace(user.id, false);
            setModal(null);
            notify("You joined the space.", "success");
          }}
          onSignIn={async () => {
            if (!supabase) return;
            if (isNativeApp()) {
              const failure = await signInWithGoogleNative(supabase);
              if (failure) notify(failure, "error");
              return;
            }
            const result = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
            if (result.error) return notify(result.error.message, "error");
            setModal(null);
          }}
          hasPasskey={hasPasskey}
          onSignInPasskey={signInWithPasskey}
          onRefreshWorkspace={async (knownTripId?: string) => {
            // The sheet already showed its own toast for this ride.
            markTripSeen(knownTripId);
            if (user) await loadWorkspace(user.id, false);
          }}
        />
      )}
    </div>
  );
}
