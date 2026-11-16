"use client";

import type { ReactNode } from "react";
import type { Member, RideGroup } from "../../lib/types";
import { egp, plural } from "./format";
import { Icon } from "./icons";

function Row({
  icon,
  title,
  sub,
  onClick,
  danger,
  disabled,
  badge,
}: {
  icon: string;
  title: string;
  sub: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button type="button" className={`setting ${danger ? "is-danger" : ""}`} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={22} />
      <span className="setting-text">
        <span className="setting-title">
          {title}
          {badge && <em>{badge}</em>}
        </span>
        <span className="setting-sub">{sub}</span>
      </span>
      <Icon name="right" size={18} className="setting-chevron" />
    </button>
  );
}

export function SpaceTab({
  group,
  members,
  currentName,
  email,
  net,
  otherName,
  unsettledCount,
  weeklyBudget,
  signedIn,
  cloud,
  nativeApp,
  notificationPermission,
  hasPasskey,
  ntfyTesting,
  onReviewUnsettled,
  onCopyCode,
  onBudget,
  onShortcut,
  onNotifications,
  onNtfyTest,
  onPasskey,
  onRemovePasskey,
  onSignOut,
  onSignIn,
}: {
  group: RideGroup;
  members: Member[];
  currentName: string;
  email?: string;
  net: number;
  otherName: string;
  unsettledCount: number;
  weeklyBudget: number;
  signedIn: boolean;
  cloud: boolean;
  nativeApp: boolean;
  notificationPermission: string;
  hasPasskey: boolean;
  ntfyTesting: boolean;
  onReviewUnsettled: () => void;
  onCopyCode: () => void;
  onBudget: () => void;
  onShortcut: () => void;
  onNotifications: () => void;
  onNtfyTest: () => void;
  onPasskey: () => void;
  onRemovePasskey: () => void;
  onSignOut: () => void;
  onSignIn: () => void;
}) {
  return (
    <main className="tab">
      <h1 className="page-title">{group.name}</h1>
      <p className="page-sub">
        {members.length > 0 ? members.map((member) => member.display_name).join(" and ") : currentName}, splitting every shared ride 50/50.
      </p>

      <section className="card">
        <header className="card-head">
          <h2>Balance</h2>
        </header>
        <p className="lead">
          {net === 0
            ? "All square."
            : net > 0
            ? `${otherName} owes you EGP ${egp(net)}.`
            : `You owe ${otherName} EGP ${egp(Math.abs(net))}.`}
          <span>
            {unsettledCount === 0 ? " Nothing waiting to be paid back." : ` ${plural(unsettledCount, "shared ride")} still unsettled.`}
          </span>
        </p>
        {unsettledCount > 0 && (
          <button type="button" className="btn btn-primary" onClick={onReviewUnsettled}>
            Review unsettled rides
          </button>
        )}
      </section>

      <section className="card">
        <header className="card-head">
          <h2>Invite code</h2>
        </header>
        <div className="code-row">
          <span className="code">{group.invite_code}</span>
          <button type="button" className="btn btn-quiet btn-small" onClick={onCopyCode}>
            <Icon name="copy" size={16} />
            Copy
          </button>
        </div>
        <p className="note">Your co-rider joins the space with this code. Automations use it too.</p>
      </section>

      <section className="settings">
        <Row
          icon="wallet"
          title="Weekly budget"
          sub={`EGP ${egp(weeklyBudget)} a week, EGP ${egp(weeklyBudget / 4)} per college day`}
          onClick={onBudget}
        />
        <Row icon="bolt" title="Log rides automatically" sub="Uber and DiDi receipts, Siri and Shortcuts" onClick={onShortcut} />
        {nativeApp && (
          <Row
            icon="bell"
            title="Ride notifications"
            badge={notificationPermission === "granted" ? "On" : undefined}
            sub={
              notificationPermission === "granted"
                ? "Alerts when a ride is auto-logged. Tap to send a test."
                : notificationPermission === "denied"
                ? "Turned off in iPhone Settings"
                : "Tap to allow alerts for auto-logged rides"
            }
            onClick={onNotifications}
          />
        )}
        {cloud && signedIn && (
          <Row
            icon="send"
            title={ntfyTesting ? "Sending test" : "Test ntfy alert"}
            sub="Sends a test push to the ntfy app"
            onClick={onNtfyTest}
            disabled={ntfyTesting}
          />
        )}
        {cloud && signedIn && !nativeApp && (
          <Row
            icon="key"
            title="Face ID sign-in"
            badge={hasPasskey ? "On" : undefined}
            sub={hasPasskey ? "Active on this device. Tap to check it works." : "Sign in with Face ID or fingerprint"}
            onClick={onPasskey}
          />
        )}
        {cloud && signedIn && !nativeApp && hasPasskey && (
          <Row icon="x" title="Remove Face ID" sub="Forget the passkey saved on this device" onClick={onRemovePasskey} />
        )}
        {cloud && signedIn ? (
          <Row icon="logout" title="Sign out" sub={email ?? currentName} onClick={onSignOut} danger />
        ) : cloud ? (
          <Row icon="user" title="Sign in with Google" sub="Open your shared ledger" onClick={onSignIn} />
        ) : null}
      </section>
    </main>
  );
}
