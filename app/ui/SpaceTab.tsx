"use client";

import type { ReactNode } from "react";
import type { RideGroup } from "../../lib/types";
import { egp } from "./format";
import { Icon } from "./icons";

function Row({ title, sub, onClick, danger, disabled, end }: { icon?: string; title: string; sub?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; end?: ReactNode }) {
  return (
    <button type="button" className={`row ${danger ? "is-danger" : ""}`} onClick={onClick} disabled={disabled}>
      <span className="row-text">
        <span className="row-title">{title}</span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      {end ?? <Icon name="right" size={18} className="row-chevron" />}
    </button>
  );
}

export function SpaceTab({
  group,
  currentName,
  email,
  weeklyBudget,
  signedIn,
  cloud,
  nativeApp,
  notificationPermission,
  hasPasskey,
  ntfyTesting,
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
  currentName: string;
  email?: string;
  weeklyBudget: number;
  signedIn: boolean;
  cloud: boolean;
  nativeApp: boolean;
  notificationPermission: string;
  hasPasskey: boolean;
  ntfyTesting: boolean;
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
    <div className="stack">
      <section className="stack-tight">
        <div className="section-head">
          <h2>Shared space</h2>
        </div>
        <div className="panel list">
          <Row icon="users" title={group.name} sub={`Invite code ${group.invite_code}`} onClick={onCopyCode} end={<span className="text-btn">Copy</span>} />
          <Row icon="wallet" title="Weekly budget" sub={`${egp(weeklyBudget)} a week, ${egp(weeklyBudget / 4)} a college day`} onClick={onBudget} />
        </div>
      </section>

      <section className="stack-tight">
        <div className="section-head">
          <h2>Automation</h2>
        </div>
        <div className="panel list">
          <Row icon="bolt" title="Log rides automatically" sub="From Uber and DiDi receipts, or Siri" onClick={onShortcut} />
          {nativeApp && (
            <Row
              icon="bell"
              title="Ride notifications"
              sub={notificationPermission === "granted" ? "On. Tap to send a test." : notificationPermission === "denied" ? "Off in iPhone Settings" : "Tap to allow"}
              onClick={onNotifications}
            />
          )}
          {cloud && signedIn && <Row icon="send" title={ntfyTesting ? "Sending" : "Test ntfy alert"} onClick={onNtfyTest} disabled={ntfyTesting} />}
        </div>
      </section>

      {cloud && (
        <section className="stack-tight">
          <div className="section-head">
            <h2>Account</h2>
          </div>
          <div className="panel list">
            {signedIn && !nativeApp && (
              <Row icon="key" title="Face ID sign-in" sub={hasPasskey ? "On for this device" : "Off"} onClick={onPasskey} />
            )}
            {signedIn && !nativeApp && hasPasskey && <Row icon="x" title="Remove Face ID" onClick={onRemovePasskey} />}
            {signedIn ? (
              <Row icon="logout" title="Sign out" sub={email ?? currentName} onClick={onSignOut} danger end={<span />} />
            ) : (
              <Row icon="user" title="Sign in with Google" onClick={onSignIn} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
