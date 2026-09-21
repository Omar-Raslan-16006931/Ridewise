"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { getSupabase } from "../lib/supabase";
import type { Member, RideGroup, Trip } from "../lib/types";

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

type Modal = "add" | "edit" | "sign-in" | "create-space" | "join-space" | "share" | null;
type AuthUser = { id: string; email?: string } | null;
type AnalyticsPeriod = "lifetime" | "week" | "month";

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
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>("lifetime");
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
  const sharedTotal = sharedTrips.reduce((sum, trip) => sum + trip.amount, 0);
  const soloTotals = members.map((member) => ({
    ...member,
    rides: soloTrips.filter((trip) => trip.solo_by === member.user_id),
    total: soloTrips.filter((trip) => trip.solo_by === member.user_id).reduce((sum, trip) => sum + trip.amount, 0),
  }));
  const analytics = useMemo(() => {
    const now = new Date();
    const startsAt = analyticsPeriod === "week"
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
      : analyticsPeriod === "month"
        ? new Date(now.getFullYear(), now.getMonth(), 1)
        : null;
    const scopedTrips = startsAt ? trips.filter((trip) => new Date(trip.ride_at) >= startsAt) : trips;
    const spend = scopedTrips.reduce((sum, trip) => sum + trip.amount, 0);
    const daysActive = new Set(scopedTrips.map((trip) => new Date(trip.ride_at).toISOString().slice(0, 10))).size;
    return {
      label: analyticsPeriod === "lifetime" ? "Lifetime" : analyticsPeriod === "week" ? "Last 7 days" : "This month",
      rides: scopedTrips.length,
      spend,
      daysActive,
      average: scopedTrips.length ? spend / scopedTrips.length : 0,
      campus: scopedTrips.filter((trip) => trip.direction === "campus").length,
      home: scopedTrips.filter((trip) => trip.direction === "home").length,
      shared: scopedTrips.filter((trip) => trip.trip_mode === "shared").length,
      solo: scopedTrips.filter((trip) => trip.trip_mode === "solo").length,
      paidByMember: members.map((member) => ({
        ...member,
        total: scopedTrips.filter((trip) => trip.paid_by === member.user_id).reduce((sum, trip) => sum + trip.amount, 0),
      })),
      spendByMember: members.map((member) => ({
        ...member,
        total: scopedTrips.reduce((sum, trip) => sum + getTripMemberSpend(trip, member.user_id), 0),
      })),
    };
  }, [analyticsPeriod, members, trips]);

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

          <section className="stat-grid" aria-label="Ride statistics">
            <article className="stat-card total-card"><span>All trips</span><strong>{trips.length}</strong><small>shared and solo rides</small></article>
            <article className="stat-card"><span>Total cost</span><strong>{money.format(stats.total)}</strong><small>all logged rides</small></article>
            {stats.totalByMember.map((member) => <article className="stat-card" key={`share-${member.user_id}`}><span>{member.display_name} total</span><strong>{money.format(member.spend)}</strong><small>half of shared + solo rides</small></article>)}
          </section>

          <section className="analytics-section" aria-label="Ride analytics">
            <div className="analytics-heading"><div><div className="eyebrow">Ride analytics</div><h2>Your rides, in context.</h2></div><div className="period-tabs" aria-label="Analytics period"><button className={analyticsPeriod === "lifetime" ? "active" : ""} onClick={() => setAnalyticsPeriod("lifetime")}>All time</button><button className={analyticsPeriod === "week" ? "active" : ""} onClick={() => setAnalyticsPeriod("week")}>7 days</button><button className={analyticsPeriod === "month" ? "active" : ""} onClick={() => setAnalyticsPeriod("month")}>Month</button></div></div>
            <p className="analytics-caption">{analytics.label} · every logged Uber, including settled rides.</p>
            <div className="analytics-grid">
              <article className="analytics-card analytics-total"><span>Total spend</span><strong>{money.format(analytics.spend)}</strong><small>{analytics.rides} rides across {analytics.daysActive} active days</small></article>
              <article className="analytics-card"><span>Average ride</span><strong>{money.format(analytics.average)}</strong><small>per logged ride</small></article>
              <article className="analytics-card"><span>Route mix</span><strong>{analytics.campus} / {analytics.home}</strong><small>campus · home</small></article>
              <article className="analytics-card"><span>Trip mix</span><strong>{analytics.shared} / {analytics.solo}</strong><small>shared · solo</small></article>
              {analytics.spendByMember.map((member) => <article className="analytics-card member-card" key={`${member.user_id}-spend`}><span>{member.display_name} share</span><strong>{money.format(member.total)}</strong><small>half of shared + solo rides</small></article>)}
            </div>
          </section>

          <section className="ledger-section">
            <div className="section-heading"><div><div className="eyebrow">Shared rides</div><h2>Split between both riders.</h2></div><button className="text-button" onClick={() => requestAction("add")}>New trip</button></div>
            <div className="section-analytics-grid shared-analytics-grid">
              <article className="stat-card total-card">
                <span>Shared total</span>
                <strong>{money.format(sharedTotal)}</strong>
                <small>{sharedTrips.length} {sharedTrips.length === 1 ? "ride" : "rides"} logged</small>
              </article>
              <article className="stat-card">
                <span>Each rider share</span>
                <strong>{money.format(sharedTotal / 2)}</strong>
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
      {modal && <ModalWindow modal={modal} close={() => { setModal(null); setEditingTrip(null); }} members={members} group={group} user={user} editingTrip={editingTrip} supabaseEnabled={Boolean(supabase)} notify={notify} onAdd={saveTrip} onCreate={async (name, person) => {
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

function ModalWindow({ modal, close, members, group, user, editingTrip, supabaseEnabled, notify, onAdd, onCreate, onJoin, onSignIn }: { modal: Exclude<Modal, null>; close: () => void; members: Member[]; group: RideGroup | null; user: AuthUser; editingTrip: Trip | null; supabaseEnabled: boolean; notify: (message: string, type?: "success" | "error" | "info") => void; onAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>; onCreate: (name: string, person: string) => Promise<void>; onJoin: (code: string, person: string) => Promise<void>; onSignIn: () => Promise<void> }) {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const tripDate = editingTrip ? new Date(new Date(editingTrip.ride_at).getTime() - new Date(editingTrip.ride_at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : localTime;
  const [tripMode, setTripMode] = useState<Trip["trip_mode"]>(editingTrip?.trip_mode ?? "shared");

  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
    <button className="modal-close" aria-label="Close" onClick={close}>×</button>
    {(modal === "add" || modal === "edit") && <><div className="eyebrow">{editingTrip ? "Edit Uber ride" : "New Uber ride"}</div><h2>{editingTrip ? "Update the details." : "Add the details."}</h2><p className="modal-copy">Track shared rides, solo rides, and every total.</p><form onSubmit={onAdd} className="form-stack"><label>Ride cost <div className="amount-field"><span>EGP</span><input name="amount" type="number" inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*" min="1" step="0.01" autoFocus required placeholder="0" defaultValue={editingTrip?.amount} /></div></label><div className="form-columns"><label>Direction<ChoiceButtons name="direction" value={editingTrip?.direction ?? "campus"} options={[{ value: "campus", label: "To campus" }, { value: "home", label: "Back home" }]} /></label><label>Trip type<ChoiceButtons name="tripMode" value={tripMode} onChange={(val) => setTripMode(val as Trip["trip_mode"])} options={[{ value: "shared", label: "Shared" }, { value: "solo", label: "Solo" }]} /></label></div><div className={`form-columns ${tripMode === "solo" ? "two-col" : "single-col"}`}><label>Paid by<ChoiceButtons name="paidBy" value={editingTrip?.paid_by ?? user?.id ?? "omar"} options={members.map((member) => ({ value: member.user_id, label: member.display_name }))} /></label><div className={`solo-rider-animator ${tripMode === "solo" ? "open" : "closed"}`}><label>Solo rider<ChoiceButtons name="soloBy" value={editingTrip?.solo_by ?? user?.id ?? "omar"} options={members.map((member) => ({ value: member.user_id, label: member.display_name }))} /></label></div></div><label>When<input name="rideAt" type="datetime-local" required defaultValue={tripDate} /></label><label>Note <input name="notes" maxLength={280} placeholder="Optional" defaultValue={editingTrip?.notes ?? ""} /></label><button className="primary full" type="submit">{editingTrip ? "Save changes" : "Save trip"}</button></form></>}
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
