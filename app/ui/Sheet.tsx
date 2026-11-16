"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Member, RideGroup, Trip } from "../../lib/types";
import { egp } from "./format";
import { Icon } from "./icons";

export type SheetKind = "add" | "edit" | "sign-in" | "create-space" | "join-space" | "share" | "budget" | "shortcut";
type Notify = (message: string, type?: "success" | "error" | "info") => void;

const TITLES: Record<SheetKind, string> = {
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
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={value === option.value ? "is-on" : ""}
            onClick={() => onChange(option.value)}
          >
            {option.icon && <Icon name={option.icon} size={18} />}
            {option.label}
          </button>
        ))}
      </div>
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
}: {
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
      <div className={`sheet ${closing ? "is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={TITLES[kind]} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <header className="sheet-head">
          <h2>{TITLES[kind]}</h2>
          <button type="button" className="icon-btn" onClick={handleClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>

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
                { value: "campus", label: "To campus", icon: "campus" },
                { value: "home", label: "Back home", icon: "home" },
              ]}
            />
            <Choice
              label="Ride"
              name="tripMode"
              value={tripMode}
              onChange={setTripMode}
              options={[
                { value: "shared", label: "Shared 50/50", icon: "users" },
                { value: "solo", label: "Solo", icon: "user" },
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

            <button type="submit" className="btn btn-primary btn-wide">
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
            <button type="submit" className="btn btn-primary btn-wide">
              Save budget
            </button>
          </form>
        )}

        {kind === "sign-in" && (
          <div className="form">
            <p className="note">Sign in with your approved Google account to open the shared ledger.</p>
            {hasPasskey && onSignInPasskey && (
              <button type="button" className="btn btn-primary btn-wide" onClick={() => void onSignInPasskey()}>
                <Icon name="key" size={18} />
                Sign in with Face ID
              </button>
            )}
            <button
              type="button"
              className={`btn btn-wide ${hasPasskey ? "btn-quiet" : "btn-primary"}`}
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
            <button type="submit" className="btn btn-primary btn-wide">
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
            <button type="submit" className="btn btn-primary btn-wide">
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
                className="btn btn-quiet btn-small"
                onClick={() => {
                  void navigator.clipboard.writeText(group.invite_code);
                  notify("Invite code copied.", "success");
                }}
              >
                <Icon name="copy" size={16} />
                Copy
              </button>
            </div>
          </div>
        )}

        {kind === "shortcut" && (
          <div className="form">
            <div className="segmented" role="tablist" aria-label="Setup method">
              <button type="button" role="tab" aria-selected={autoMode === "email"} className={autoMode === "email" ? "is-on" : ""} onClick={() => setAutoMode("email")}>
                From receipts
              </button>
              <button type="button" role="tab" aria-selected={autoMode === "manual"} className={autoMode === "manual" ? "is-on" : ""} onClick={() => setAutoMode("manual")}>
                Siri or one tap
              </button>
            </div>

            {autoMode === "email" ? (
              <>
                <p className="note">
                  When Uber or DiDi emails a receipt, it is forwarded to Ridewise, which reads the fare, date, time and direction and logs the ride for you.
                </p>

                <section className="guide">
                  <h3>With n8n, recommended</h3>
                  <p className="note">Watches your Gmail, iCloud or IMAP inbox and forwards each receipt in the background.</p>
                  <button type="button" className="btn btn-primary btn-wide" onClick={copyN8nWorkflow}>
                    <Icon name="copy" size={18} />
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
                  <a href="shortcuts://" className="btn btn-quiet btn-wide">
                    Open Shortcuts
                    <Icon name="external" size={16} />
                  </a>
                </section>

                <section className="guide">
                  <h3>Try it with a receipt</h3>
                  <textarea rows={3} placeholder="Paste an Uber or DiDi email receipt" value={receiptText} onChange={(e) => setReceiptText(e.target.value)} />
                  <button type="button" className="btn btn-primary btn-wide" disabled={parsing} onClick={() => void testReceipt()}>
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
                <a href="shortcuts://" className="btn btn-primary btn-wide">
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
