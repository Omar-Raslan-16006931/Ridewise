"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { Member, RideGroup, Trip } from "../../lib/types";
import { egp } from "./format";
import { Icon } from "./icons";
import { Money } from "./numbers";
import { rideStatus } from "./rides";
import { Segmented } from "./Segmented";
import { formatDay, formatTime } from "./format";

export type SheetKind = "ride" | "add" | "edit" | "sign-in" | "create-space" | "join-space" | "share" | "budget" | "shortcut";
type Notify = (message: string, type?: "success" | "error" | "info") => void;

const TITLES: Record<SheetKind, string> = {
  ride: "Ride",
  add: "Log ride",
  edit: "Edit ride",
  budget: "Weekly budget",
  shortcut: "Log rides automatically",
  "sign-in": "Sign in",
  "create-space": "Create a shared space",
  "join-space": "Join a shared space",
  share: "Invite your co-rider",
};

const FARE_PRESETS = [60, 90, 110, 125, 150];
const BUDGET_PRESETS = [400, 500, 600, 700, 800, 1000];

function toLocalInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function Choice<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: T;
  options: { value: T; label: string; icon?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <input type="hidden" name={name} value={value} />
      <Segmented
        label={label}
        value={value}
        onChange={onChange}
        options={options.map((option) => ({
          value: option.value,
          label: (
            <>
              {option.icon && <Icon name={option.icon} size={17} />}
              {option.label}
            </>
          ),
        }))}
      />
    </div>
  );
}

function CopyRow({ label, value, notify }: { label: string; value: string; notify: Notify }) {
  return (
    <div className="kv">
      <span className="kv-key">{label}</span>
      <code className="kv-value">{value}</code>
      <button
        type="button"
        className="link"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          notify(`Copied ${value}`, "info");
        }}
      >
        Copy
      </button>
    </div>
  );
}

export function Sheet({
  kind,
  close,
  members,
  group,
  user,
  editingTrip,
  prefill,
  notify,
  weeklyBudget,
  onSaveBudget,
  onAdd,
  onCreate,
  onJoin,
  onSignIn,
  hasPasskey,
  onSignInPasskey,
  onRefreshWorkspace,
  trip,
  currentUserId,
  onSettleTrip,
  onEditTrip,
  onDeleteTrip,
}: {
  trip?: Trip | null;
  currentUserId?: string;
  onSettleTrip?: (trip: Trip, paidByMemberId?: string) => void;
  onEditTrip?: (trip: Trip) => void;
  onDeleteTrip?: (trip: Trip) => void;
  kind: SheetKind;
  close: () => void;
  members: Member[];
  group: RideGroup | null;
  user: { id: string; email?: string } | null;
  editingTrip: Trip | null;
  prefill?: { amount?: string; mode?: "shared" | "solo"; paidBy?: string } | null;
  notify: Notify;
  weeklyBudget: number;
  onSaveBudget: (budget: number) => void;
  onAdd: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCreate: (name: string, person: string) => Promise<void>;
  onJoin: (code: string, person: string) => Promise<void>;
  onSignIn: () => Promise<void>;
  hasPasskey?: boolean;
  onSignInPasskey?: () => Promise<void>;
  onRefreshWorkspace?: (knownTripId?: string) => Promise<void>;
}) {
  const now = new Date();
  const tripDate = editingTrip ? toLocalInput(new Date(editingTrip.ride_at)) : toLocalInput(now);
  const matchedPayer = prefill?.paidBy
    ? members.find((m) => m.user_id === prefill.paidBy || m.display_name.toLowerCase() === prefill.paidBy?.toLowerCase())?.user_id
    : undefined;
  const fallbackMember = user?.id ?? members[0]?.user_id ?? "omar";

  const [tripMode, setTripMode] = useState<Trip["trip_mode"]>(editingTrip?.trip_mode ?? prefill?.mode ?? "shared");
  const [direction, setDirection] = useState<Trip["direction"]>(editingTrip?.direction ?? (now.getHours() < 13 ? "campus" : "home"));
  const [amount, setAmount] = useState<string>(editingTrip ? String(editingTrip.amount) : prefill?.amount ? String(prefill.amount) : "");
  const [paidBy, setPaidBy] = useState<string>(editingTrip?.paid_by ?? matchedPayer ?? fallbackMember);
  const [soloBy, setSoloBy] = useState<string>(editingTrip?.solo_by ?? matchedPayer ?? fallbackMember);
  const [budgetDraft, setBudgetDraft] = useState<string>(String(weeklyBudget));
  const [closing, setClosing] = useState(false);
  const [autoMode, setAutoMode] = useState<"email" | "manual">("email");
  const [receiptText, setReceiptText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);

  // Drag the grabber or title down to close, like an iOS sheet.
  const dragHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      drag.current = { y: e.touches[0].clientY, dy: 0 };
      if (sheetRef.current) sheetRef.current.style.transition = "none";
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (!drag.current) return;
      const dy = Math.max(0, e.touches[0].clientY - drag.current.y);
      drag.current.dy = dy;
      if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
    },
    onTouchEnd: () => {
      const dy = drag.current?.dy ?? 0;
      drag.current = null;
      const el = sheetRef.current;
      if (!el) return;
      el.style.transition = "transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)";
      if (dy > 110) {
        el.style.transform = "translateY(110%)";
        setClosing(true);
        setTimeout(close, 260);
      } else {
        el.style.transform = "";
      }
    },
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "https://ubershareride.vercel.app";
  const apiUrl = `${origin}/api/trips`;
  const inviteCode = group?.invite_code || "RIDE2026";
  const memberOptions = members.map((m) => ({ value: m.user_id, label: m.display_name }));
  const fare = Number(amount) || 0;

  function handleClose() {
    if (closing) return;
    setClosing(true);
    setTimeout(close, 240);
  }

  // Keep the page behind the sheet from scrolling.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  async function submitRide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (closing) return;
    setClosing(true);
    await onAdd(event);
    setTimeout(close, 240);
  }

  async function testReceipt() {
    if (!receiptText.trim()) return notify("Paste an Uber or DiDi email receipt first.", "info");
    setParsing(true);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_code: group?.invite_code, email_body: receiptText }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Could not read that receipt.");
      const service = data.parsed_receipt?.service ? data.parsed_receipt.service.toUpperCase() : "Ride";
      const amt = data.parsed_receipt?.amount ?? data.trip?.amount;
      const dir = data.parsed_receipt?.direction ?? data.trip?.direction;
      notify(`Auto-logged ${service}: EGP ${amt}, ${dir === "campus" ? "to campus" : "back home"}.`, "success");
      setReceiptText("");
      handleClose();
      if (onRefreshWorkspace) await onRefreshWorkspace(data.trip?.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not read that receipt.", "error");
    } finally {
      setParsing(false);
    }
  }

  function copyN8nWorkflow() {
    const workflow = {
      name: "Ridewise - Uber & DiDi Receipt Auto-Logger",
      nodes: [
        {
          parameters: {
            pollTimes: { item: [{ mode: "everyMinute" }] },
            filters: { q: "from:(uber.com OR didiglobal.com) (receipt OR trip OR رحلة OR إيصال)" },
          },
          id: "1",
          name: "Gmail - New Uber/DiDi Receipt",
          type: "n8n-nodes-base.gmailTrigger",
          typeVersion: 1.2,
          position: [240, 300],
        },
        {
          parameters: {
            method: "POST",
            url: apiUrl,
            sendBody: true,
            specifyBody: "keypair",
            bodyParameters: {
              parameters: [
                { name: "group_code", value: inviteCode },
                { name: "email_body", value: "={{ $json.snippet ? ($json.snippet + '\\n' + ($json.text || '')) : ($json.text || $json.html || '') }}" },
                { name: "subject", value: "={{ $json.subject || '' }}" },
                { name: "email_date", value: "={{ $json.date || '' }}" },
              ],
            },
          },
          id: "2",
          name: "HTTP - Send to Ridewise",
          type: "n8n-nodes-base.httpRequest",
          typeVersion: 4.2,
          position: [480, 300],
        },
      ],
      connections: {
        "Gmail - New Uber/DiDi Receipt": { main: [[{ node: "HTTP - Send to Ridewise", type: "main", index: 0 }]] },
      },
      pinData: {},
    };
    void navigator.clipboard.writeText(JSON.stringify(workflow, null, 2));
    notify("Workflow copied. Paste it onto an n8n canvas.", "success");
  }

  return (
    <div className={`sheet-backdrop ${closing ? "is-closing" : ""}`} onClick={handleClose}>
      <div
        ref={sheetRef}
        className={`sheet ${closing ? "is-closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[kind]}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-drag" {...dragHandlers}>
          <div className="sheet-grip" aria-hidden="true" />
          <header className="sheet-head">
            <h2>{kind === "ride" && trip ? (trip.direction === "campus" ? "To campus" : "Back home") : TITLES[kind]}</h2>
            <button type="button" className="icon-btn" onClick={handleClose} aria-label="Close">
              <Icon name="x" size={20} />
            </button>
          </header>
        </div>

        {kind === "ride" && trip && (() => {
          const solo = trip.trip_mode === "solo";
          const iPaid = trip.paid_by === currentUserId;
          const payer = members.find((m) => m.user_id === trip.paid_by)?.display_name ?? "Someone";
          const debtor = members.find((m) => m.user_id !== trip.paid_by);
          const myShare = solo ? (trip.solo_by === currentUserId ? trip.amount : 0) : trip.amount / 2;
          const status = rideStatus(trip, members, currentUserId ?? "");
          return (
            <div className="form">
              <div className="ride-hero">
                <Money value={trip.amount} className="num-hero" />
                <span className="secondary">
                  {formatDay(trip.ride_at)}, {formatTime(trip.ride_at)}
                </span>
              </div>
              <div className="glass list list-inset">
                <div className="row row-static">
                  <span className="row-title">Ride</span>
                  <span className="row-value-soft">{solo ? "Solo" : "Shared 50/50"}</span>
                </div>
                <div className="row row-static">
                  <span className="row-title">{solo ? "Rider" : "Paid Uber"}</span>
                  <span className="row-value-soft">{solo ? members.find((m) => m.user_id === trip.solo_by)?.display_name : payer}</span>
                </div>
                <div className="row row-static">
                  <span className="row-title">Your share</span>
                  <span className="row-value-soft">EGP {egp(myShare)}</span>
                </div>
                {!solo && (
                  <div className="row row-static">
                    <span className="row-title">Status</span>
                    <span className={`row-value-soft status-${status.tone || "plain"}`}>{status.text}</span>
                  </div>
                )}
                {trip.notes && (
                  <div className="row row-static">
                    <span className="row-title">Note</span>
                    <span className="row-value-soft">{trip.notes}</span>
                  </div>
                )}
              </div>
              {!solo && !trip.settled_at && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    onSettleTrip?.(trip, iPaid ? debtor?.user_id : currentUserId);
                    handleClose();
                  }}
                >
                  {iPaid ? `${debtor?.display_name ?? "They"} paid me back` : "I paid my half"}
                </button>
              )}
              <div className="btn-row">
                <button type="button" className="btn btn-glass" onClick={() => onEditTrip?.(trip)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-glass is-danger"
                  onClick={() => {
                    if (!confirmDelete) return setConfirmDelete(true);
                    onDeleteTrip?.(trip);
                    handleClose();
                  }}
                >
                  {confirmDelete ? "Tap again to delete" : "Delete"}
                </button>
              </div>
            </div>
          );
        })()}

        {(kind === "add" || kind === "edit") && (
          <form onSubmit={submitRide} className="form">
            <div className="amount-box">
              <label className="amount-entry">
                <span className="amount-code">EGP</span>
                <input
                  name="amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="1"
                  required
                  placeholder="0"
                  aria-label="Fare in EGP"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={`amount-input ${(amount || "").length > 5 ? "is-long" : ""}`}
                  style={{ width: `${Math.max(1, (amount || "0").length) + 0.4}ch` }}
                />
              </label>
              <p className="amount-hint" aria-live="polite">
                {fare > 0 ? (tripMode === "shared" ? `EGP ${egp(fare / 2)} each` : "Full fare, not split") : "Enter the fare Uber charged"}
              </p>
              <div className="chips chips-center">
                {FARE_PRESETS.map((preset) => (
                  <button key={preset} type="button" className={`chip ${amount === String(preset) ? "is-on" : ""}`} onClick={() => setAmount(String(preset))}>
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <Choice
              label="Direction"
              name="direction"
              value={direction}
              onChange={setDirection}
              options={[
                { value: "campus", label: "To campus", },
                { value: "home", label: "Back home", },
              ]}
            />
            <Choice
              label="Ride"
              name="tripMode"
              value={tripMode}
              onChange={setTripMode}
              options={[
                { value: "shared", label: "Shared 50/50", },
                { value: "solo", label: "Solo", },
              ]}
            />
            {tripMode === "shared" ? (
              <>
                <Choice label="Who paid Uber" name="paidBy" value={paidBy} onChange={setPaidBy} options={memberOptions} />
                <input type="hidden" name="soloBy" value={soloBy} />
              </>
            ) : (
              <>
                <Choice label="Who rode" name="soloBy" value={soloBy} onChange={setSoloBy} options={memberOptions} />
                <input type="hidden" name="paidBy" value={soloBy} />
              </>
            )}

            <label className="field">
              <span className="field-label">When</span>
              <input name="rideAt" type="datetime-local" required defaultValue={tripDate} />
            </label>
            <label className="field">
              <span className="field-label">Note, optional</span>
              <input name="notes" placeholder="Morning lecture, heavy traffic" maxLength={280} defaultValue={editingTrip?.notes ?? ""} />
            </label>

            <button type="submit" className="btn btn-primary">
              {editingTrip ? "Save changes" : "Save ride"}
            </button>
          </form>
        )}

        {kind === "budget" && (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number(budgetDraft);
              if (value > 0) {
                onSaveBudget(value);
                handleClose();
              }
            }}
          >
            <p className="note">Your own allowance for a week of rides. It is spread over the 4 college days, and four weeks make the monthly budget.</p>
            <label className="field">
              <span className="field-label">EGP per week</span>
              <input name="budget" type="number" inputMode="numeric" min="100" step="50" required value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value)} />
            </label>
            <div className="chips">
              {BUDGET_PRESETS.map((preset) => (
                <button key={preset} type="button" className={`chip ${budgetDraft === String(preset) ? "is-on" : ""}`} onClick={() => setBudgetDraft(String(preset))}>
                  {preset}
                </button>
              ))}
            </div>
            <p className="note">
              {Number(budgetDraft) > 0
                ? `EGP ${egp(Number(budgetDraft) / 4)} per college day, EGP ${egp(Number(budgetDraft) * 4)} a month.`
                : "Enter an amount."}
            </p>
            <button type="submit" className="btn btn-primary">
              Save budget
            </button>
          </form>
        )}

        {kind === "sign-in" && (
          <div className="form">
            <p className="note">Sign in with your approved Google account to open the shared ledger.</p>
            {hasPasskey && onSignInPasskey && (
              <button type="button" className="btn btn-primary" onClick={() => void onSignInPasskey()}>
                Sign in with Face ID
              </button>
            )}
            <button
              type="button"
              className={`btn ${hasPasskey ? "btn-glass" : "btn-primary"}`}
              onClick={() => {
                handleClose();
                void onSignIn();
              }}
            >
              Continue with Google
            </button>
          </div>
        )}

        {kind === "create-space" && (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              handleClose();
              void onCreate(String(data.get("space")), String(data.get("name")));
            }}
          >
            <label className="field">
              <span className="field-label">Space name</span>
              <input name="space" required defaultValue="Omar + Khaled" />
            </label>
            <label className="field">
              <span className="field-label">Your name</span>
              <input name="name" required defaultValue={user?.email?.split("@")[0] ?? ""} />
            </label>
            <button type="submit" className="btn btn-primary">
              Create space
            </button>
          </form>
        )}

        {kind === "join-space" && (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              handleClose();
              void onJoin(String(data.get("code")), String(data.get("name")));
            }}
          >
            <label className="field">
              <span className="field-label">Invite code</span>
              <input name="code" required placeholder="RIDE2026" autoCapitalize="characters" />
            </label>
            <label className="field">
              <span className="field-label">Your name</span>
              <input name="name" required defaultValue={user?.email?.split("@")[0] ?? ""} />
            </label>
            <button type="submit" className="btn btn-primary">
              Join space
            </button>
          </form>
        )}

        {kind === "share" && group && (
          <div className="form">
            <p className="note">Send this code to your co-rider. They enter it under Join with code.</p>
            <div className="code-row">
              <span className="code">{group.invite_code}</span>
              <button
                type="button"
                className="pill"
                onClick={() => {
                  void navigator.clipboard.writeText(group.invite_code);
                  notify("Invite code copied.", "success");
                }}
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {kind === "shortcut" && (
          <div className="form">
            <Segmented
              label="Setup method"
              value={autoMode}
              onChange={setAutoMode}
              options={[
                { value: "email", label: "From receipts" },
                { value: "manual", label: "Siri or one tap" },
              ]}
            />

            {autoMode === "email" ? (
              <>
                <p className="note">
                  When Uber or DiDi emails a receipt, it is forwarded to Ridewise, which reads the fare, date, time and direction and logs the ride for you.
                </p>

                <section className="guide">
                  <h3>With n8n, recommended</h3>
                  <p className="note">Watches your Gmail, iCloud or IMAP inbox and forwards each receipt in the background.</p>
                  <button type="button" className="btn btn-primary" onClick={copyN8nWorkflow}>
                    Copy the n8n workflow
                  </button>
                  <ol className="steps">
                    <li>Open an n8n workflow canvas and paste.</li>
                    <li>Connect your email account on the trigger node.</li>
                    <li>Switch the workflow to Active.</li>
                  </ol>
                </section>

                <section className="guide">
                  <h3>With iOS Shortcuts</h3>
                  <ol className="steps">
                    <li>In Shortcuts, open Automation, tap +, choose Email.</li>
                    <li>
                      Sender contains <code>uber</code> or <code>didi</code>, subject contains <code>trip</code> or <code>receipt</code>. Choose Run Immediately.
                    </li>
                    <li>
                      Add the action Get Contents of URL, method POST, request body JSON, with the two fields below.
                    </li>
                  </ol>
                  <CopyRow label="URL" value={apiUrl} notify={notify} />
                  <CopyRow label="group_code" value={inviteCode} notify={notify} />
                  <div className="kv">
                    <span className="kv-key">email_body</span>
                    <span className="kv-value">Shortcut Input</span>
                  </div>
                  <a href="shortcuts://" className="btn btn-glass">
                    Open Shortcuts
                    <Icon name="external" size={16} />
                  </a>
                </section>

                <section className="guide">
                  <h3>Try it with a receipt</h3>
                  <textarea rows={3} placeholder="Paste an Uber or DiDi email receipt" value={receiptText} onChange={(e) => setReceiptText(e.target.value)} />
                  <button type="button" className="btn btn-primary" disabled={parsing} onClick={() => void testReceipt()}>
                    {parsing ? "Reading receipt" : "Read receipt and log the ride"}
                  </button>
                </section>
              </>
            ) : (
              <>
                <p className="note">
                  Build a Shortcut that asks for the fare and sends it to Ridewise. Use the action Get Contents of URL with method POST and a JSON body.
                </p>
                <section className="guide">
                  <h3>Request</h3>
                  <CopyRow label="URL" value={apiUrl} notify={notify} />
                  <div className="kv">
                    <span className="kv-key">Method</span>
                    <span className="kv-value">POST</span>
                  </div>
                </section>
                <section className="guide">
                  <h3>JSON fields</h3>
                  <CopyRow label="group_code" value={inviteCode} notify={notify} />
                  <div className="kv">
                    <span className="kv-key">amount</span>
                    <span className="kv-value">Number, from Ask for Number</span>
                  </div>
                  <div className="kv">
                    <span className="kv-key">trip_mode</span>
                    <span className="kv-value">Text, shared or solo</span>
                  </div>
                  <div className="kv">
                    <span className="kv-key">paid_by</span>
                    <span className="kv-value">Text, {members.map((m) => m.display_name).join(" or ") || "Omar or Khaled"}</span>
                  </div>
                </section>
                <a href="shortcuts://" className="btn btn-primary">
                  Open Shortcuts
                  <Icon name="external" size={16} />
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
