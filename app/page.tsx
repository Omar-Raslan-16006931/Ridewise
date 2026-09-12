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
  { id: "1", ride_at: "2026-09-12T07:42:00.000Z", direction: "campus", amount: 118, paid_by: "omar", notes: "Morning lecture", settled_at: null, settled_by: null },
  { id: "2", ride_at: "2026-09-11T16:18:00.000Z", direction: "home", amount: 96, paid_by: "khaled", notes: null, settled_at: null, settled_by: null },
  { id: "3", ride_at: "2026-09-10T07:50:00.000Z", direction: "campus", amount: 110, paid_by: "khaled", notes: "Traffic was wild", settled_at: "2026-09-10T13:04:00.000Z", settled_by: "omar" },
  { id: "4", ride_at: "2026-09-09T16:05:00.000Z", direction: "home", amount: 102, paid_by: "omar", notes: null, settled_at: "2026-09-09T19:20:00.000Z", settled_by: "khaled" },
  { id: "5", ride_at: "2026-09-08T08:11:00.000Z", direction: "campus", amount: 124, paid_by: "omar", notes: null, settled_at: "2026-09-08T13:12:00.000Z", settled_by: "khaled" },
];

type Modal = "add" | "edit" | "sign-in" | "create-space" | "join-space" | "share" | null;
type AuthUser = { id: string; email?: string } | null;

const money = new Intl.NumberFormat("en-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

function getOtherMember(members: Member[], userId: string) {
  return members.find((member) => member.user_id !== userId) ?? null;
}

export default function Home() {
  const supabase = getSupabase();
  const [user, setUser] = useState<AuthUser>(null);
  const [group, setGroup] = useState<RideGroup | null>(supabase ? null : demoGroup);
  const [members, setMembers] = useState<Member[]>(supabase ? [] : demoMembers);
  const [trips, setTrips] = useState<Trip[]>(supabase ? [] : demoTrips);
  const [modal, setModal] = useState<Modal>(null);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(Boolean(supabase));

  const currentUserId = user?.id ?? "omar";
  const currentName = members.find((member) => member.user_id === currentUserId)?.display_name ?? "Omar";
  const otherMember = getOtherMember(members, currentUserId);

  async function loadWorkspace(userId: string) {
    if (!supabase) return;
    setLoading(true);
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
      supabase.from("ride_trips").select("id,ride_at,direction,amount,paid_by,notes,settled_at,settled_by").eq("group_id", membership.data.group_id).order("ride_at", { ascending: false }),
    ]);
    if (groupResult.data) setGroup(groupResult.data as RideGroup);
    setMembers((membersResult.data ?? []) as Member[]);
    setTrips((tripsResult.data ?? []).map((trip) => ({ ...trip, amount: Number(trip.amount) })) as Trip[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const sessionUser = data.session?.user;
      setUser(sessionUser ? { id: sessionUser.id, email: sessionUser.email } : null);
      if (sessionUser) void loadWorkspace(sessionUser.id);
      else setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user;
      setUser(sessionUser ? { id: sessionUser.id, email: sessionUser.email } : null);
      if (sessionUser) void loadWorkspace(sessionUser.id);
    });
    return () => listener.subscription.unsubscribe();
  // This client is a module singleton; subscribing once is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const activeTrips = trips.filter((trip) => !trip.settled_at);
    const owedToYou = activeTrips.filter((trip) => trip.paid_by === currentUserId).reduce((sum, trip) => sum + trip.amount / 2, 0);
    const youOwe = activeTrips.filter((trip) => trip.paid_by !== currentUserId).reduce((sum, trip) => sum + trip.amount / 2, 0);
    const total = trips.reduce((sum, trip) => sum + trip.amount, 0);
    const toCampus = trips.filter((trip) => trip.direction === "campus").length;
    const toHome = trips.length - toCampus;
    const paidByYou = trips.filter((trip) => trip.paid_by === currentUserId).reduce((sum, trip) => sum + trip.amount, 0);
    return { owedToYou, youOwe, net: owedToYou - youOwe, total, toCampus, toHome, paidByYou };
  }, [trips, currentUserId]);

  const recentTrips = [...trips].sort((a, b) => +new Date(b.ride_at) - +new Date(a.ride_at));

  async function saveTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    const direction = String(form.get("direction")) as Trip["direction"];
    const paidBy = String(form.get("paidBy"));
    const rideAt = String(form.get("rideAt"));
    const notes = String(form.get("notes") ?? "").trim();
    if (!amount || amount <= 0 || !group) return;
    const tripValues = { amount, direction, paid_by: paidBy, ride_at: new Date(rideAt).toISOString(), notes: notes || null };
    if (editingTrip) {
      if (supabase && user) {
        const result = await supabase.from("ride_trips").update(tripValues).eq("id", editingTrip.id);
        if (result.error) return setNotice(result.error.message);
        await loadWorkspace(user.id);
      } else {
        setTrips((existing) => existing.map((trip) => trip.id === editingTrip.id ? { ...trip, ...tripValues } : trip));
      }
      setNotice("Trip details updated.");
    } else {
      const newTrip = { id: crypto.randomUUID(), ...tripValues, settled_at: null, settled_by: null };
      if (supabase && user) {
        const result = await supabase.from("ride_trips").insert({ ...newTrip, group_id: group.id, created_by: user.id });
        if (result.error) return setNotice(result.error.message);
        await loadWorkspace(user.id);
      } else {
        setTrips((existing) => [newTrip, ...existing]);
      }
      setNotice("Trip saved. The split is ready.");
    }
    setModal(null);
    setEditingTrip(null);
  }

  async function settleTrip(trip: Trip) {
    const settledAt = new Date().toISOString();
    if (supabase && user) {
      const result = await supabase.from("ride_trips").update({ settled_at: settledAt, settled_by: user.id }).eq("id", trip.id);
      if (result.error) return setNotice(result.error.message);
      await loadWorkspace(user.id);
    } else {
      setTrips((existing) => existing.map((item) => item.id === trip.id ? { ...item, settled_at: settledAt, settled_by: currentUserId } : item));
    }
    setNotice("That half is marked paid.");
  }

  function requestAction(action: Modal) {
    if (supabase && !user) setModal("sign-in");
    else if (supabase && !group && action === "add") setModal("create-space");
    else setModal(action);
  }

  if (loading) return <main className="loading-screen"><div className="loader" /><p>Opening your rides</p></main>;

  return (
    <main>
      <nav className="topbar">
        <button className="brand" onClick={() => setNotice("")}>ridewise<span>.</span></button>
        <div className="nav-right">
          {group && <button className="group-switch" onClick={() => requestAction("share")}>{group.name}<i /></button>}
          {supabase && user && <button className="avatar" onClick={() => { void supabase.auth.signOut(); setGroup(null); }}>{currentName.slice(0, 1)}</button>}
          {!supabase && <span className="demo-tag">Preview</span>}
        </div>
      </nav>

      {!group ? (
        <section className="empty-space">
          <div className="eyebrow">Your shared ride ledger</div>
          <h1>Make every ride<br />feel fair.</h1>
          <p>Start your shared space, then send Khaled the invite code. Every trip splits itself down the middle.</p>
          <div className="empty-actions"><button className="primary" onClick={() => setModal("create-space")}>Create our space</button><button className="secondary" onClick={() => setModal("join-space")}>Join with a code</button></div>
        </section>
      ) : (
        <>
          <section className="summary">
            <div className="summary-copy">
              <div className="eyebrow">{group.name} · shared rides</div>
              <h1>{stats.net === 0 ? "You’re all square." : stats.net > 0 ? `${otherMember?.display_name ?? "Your friend"} owes you` : `You owe ${otherMember?.display_name ?? "your friend"}`}</h1>
              <p className="balance">{stats.net === 0 ? "No pending halves right now." : money.format(Math.abs(stats.net))}</p>
              <p className="balance-note">{stats.net === 0 ? "Log the next ride when you’re ready." : stats.net > 0 ? "across your unsettled rides" : "across their unsettled rides"}</p>
              <button className="primary add-button" onClick={() => requestAction("add")}><b>+</b> Add a ride</button>
            </div>
            <div className="balance-orbit" aria-hidden="true">
              <div className="orbit-line line-one" /><div className="orbit-line line-two" />
              <div className="orbit-center">50<span>%</span></div>
              <div className="orbit-label top">each rider</div><div className="orbit-label bottom">every trip</div>
            </div>
          </section>

          {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice("")}>Close</button></div>}

          <section className="stat-grid" aria-label="Ride statistics">
            <article className="stat-card total-card"><span>Total rides</span><strong>{trips.length}</strong><small>{money.format(stats.total)} moved together</small></article>
            <article className="stat-card"><span>You covered</span><strong>{money.format(stats.paidByYou)}</strong><small>before any splits</small></article>
            <article className="stat-card"><span>Still pending</span><strong>{recentTrips.filter((trip) => !trip.settled_at).length}</strong><small>{money.format(stats.owedToYou + stats.youOwe)} in halves</small></article>
            <article className="stat-card route-card"><span>This month</span><div className="route-count"><b>{stats.toCampus}</b><i /><b>{stats.toHome}</b></div><small>to campus · back home</small></article>
          </section>

          <section className="ledger-section">
            <div className="section-heading"><div><div className="eyebrow">Shared ledger</div><h2>Every ride, clearly settled.</h2></div><button className="text-button" onClick={() => requestAction("add")}>New trip</button></div>
            <div className="ledger">
              {recentTrips.length === 0 ? <div className="ledger-empty">No rides logged yet. Add the first one above.</div> : recentTrips.map((trip) => {
                const payer = members.find((member) => member.user_id === trip.paid_by)?.display_name ?? "Unknown";
                const debtor = getOtherMember(members, trip.paid_by)?.display_name ?? "The other rider";
                const currentUserIsDebtor = trip.paid_by !== currentUserId;
                return <article className="trip-row" key={trip.id}>
                  <div className={`trip-direction ${trip.direction}`}><span /><b>{trip.direction === "campus" ? "To campus" : "Back home"}</b><small>{dateFormatter.format(new Date(trip.ride_at))}</small></div>
                  <div className="trip-detail"><b>{payer} paid</b><span>{trip.notes || "Uber ride"}</span></div>
                  <div className="trip-price"><b>{money.format(trip.amount)}</b><span>{money.format(trip.amount / 2)} each</span></div>
                  <div className="trip-status">
                    <button className="edit-button" onClick={() => { setEditingTrip(trip); setModal("edit"); }}>Edit</button>
                    {trip.settled_at ? <span className="settled">Settled</span> : currentUserIsDebtor ? <button className="settle-button" onClick={() => void settleTrip(trip)}>I paid my half</button> : <span className="waiting">Waiting for {debtor}</span>}
                  </div>
                </article>;
              })}
            </div>
          </section>
        </>
      )}

      <footer><span>Ridewise is a shared balance, not a bank.</span><span>Split every Uber equally.</span></footer>
      {modal && <ModalWindow modal={modal} close={() => { setModal(null); setEditingTrip(null); }} members={members} group={group} user={user} editingTrip={editingTrip} supabaseEnabled={Boolean(supabase)} onAdd={saveTrip} onCreate={async (name, person) => {
        if (!supabase || !user) return;
        const result = await supabase.rpc("create_ride_group", { group_name: name, member_name: person });
        if (result.error) return setNotice(result.error.message);
        await loadWorkspace(user.id); setModal("share");
      }} onJoin={async (code, person) => {
        if (!supabase || !user) return;
        const result = await supabase.rpc("join_ride_group", { group_code: code, member_name: person });
        if (result.error) return setNotice(result.error.message);
        await loadWorkspace(user.id); setModal(null);
      }} onSignIn={async (email) => {
        if (!supabase) return;
        const result = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
        if (result.error) return setNotice(result.error.message);
        setModal(null); setNotice("Check your email for the secure sign-in link.");
      }} />}
    </main>
  );
}

function ModalWindow({ modal, close, members, group, user, editingTrip, supabaseEnabled, onAdd, onCreate, onJoin, onSignIn }: { modal: Exclude<Modal, null>; close: () => void; members: Member[]; group: RideGroup | null; user: AuthUser; editingTrip: Trip | null; supabaseEnabled: boolean; onAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>; onCreate: (name: string, person: string) => Promise<void>; onJoin: (code: string, person: string) => Promise<void>; onSignIn: (email: string) => Promise<void> }) {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const tripDate = editingTrip ? new Date(new Date(editingTrip.ride_at).getTime() - new Date(editingTrip.ride_at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : localTime;
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
    <button className="modal-close" aria-label="Close" onClick={close}>×</button>
    {(modal === "add" || modal === "edit") && <><div className="eyebrow">{editingTrip ? "Edit Uber ride" : "New Uber ride"}</div><h2>{editingTrip ? "Update the details." : "Add the details."}</h2><p className="modal-copy">We’ll make the split exactly 50/50.</p><form onSubmit={onAdd} className="form-stack"><label>Ride cost <div className="amount-field"><span>EGP</span><input name="amount" type="number" min="1" step="0.01" autoFocus required placeholder="0" defaultValue={editingTrip?.amount} /></div></label><div className="form-columns"><label>Direction<select name="direction" defaultValue={editingTrip?.direction ?? "campus"}><option value="campus">To campus</option><option value="home">Back home</option></select></label><label>Paid by<select name="paidBy" defaultValue={editingTrip?.paid_by ?? user?.id ?? "omar"}>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></label></div><label>When<input name="rideAt" type="datetime-local" required defaultValue={tripDate} /></label><label>Note <input name="notes" maxLength={280} placeholder="Optional" defaultValue={editingTrip?.notes ?? ""} /></label><button className="primary full" type="submit">{editingTrip ? "Save changes" : "Save shared ride"}</button></form></>}
    {modal === "sign-in" && <><div className="eyebrow">One secure link</div><h2>Welcome to Ridewise.</h2><p className="modal-copy">Use your email and we’ll send you a secure sign-in link. No password to remember.</p><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void onSignIn(String(new FormData(event.currentTarget).get("email"))); }}><label>Email address<input autoFocus required type="email" name="email" placeholder="you@example.com" /></label><button className="primary full" type="submit">Send sign-in link</button></form></>}
    {modal === "create-space" && <><div className="eyebrow">First things first</div><h2>Make your shared space.</h2><p className="modal-copy">You’ll get an invite code to send Khaled when it’s ready.</p><form className="form-stack" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onCreate(String(data.get("space")), String(data.get("name"))); }}><label>Space name<input name="space" autoFocus required defaultValue="Omar + Khaled" /></label><label>Your name<input name="name" required defaultValue={user?.email?.split("@")[0] ?? ""} /></label><button className="primary full" type="submit">Create space</button></form></>}
    {modal === "join-space" && <><div className="eyebrow">Your friend invited you</div><h2>Join the ride ledger.</h2><form className="form-stack" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onJoin(String(data.get("code")), String(data.get("name"))); }}><label>Invite code<input name="code" autoFocus required placeholder="RIDE2026" /></label><label>Your name<input name="name" required defaultValue={user?.email?.split("@")[0] ?? ""} /></label><button className="primary full" type="submit">Join shared space</button></form></>}
    {modal === "share" && group && <><div className="eyebrow">Your shared space is ready</div><h2>Invite your co-pilot.</h2><p className="modal-copy">Send this code to your friend. They sign in, choose “Join with a code,” and both of you will see the same ledger.</p><div className="invite-code">{group.invite_code}</div><button className="primary full" onClick={() => { void navigator.clipboard.writeText(group.invite_code); }}>Copy invite code</button><p className="modal-footnote">{supabaseEnabled ? "Only people with this code can join." : "This preview code becomes real after Supabase is connected."}</p></>}
  </section></div>;
}
