"use client";

import type { ReactNode } from "react";
import type { RideGroup } from "../../lib/types";
import { egp } from "./format";
import { Icon } from "./icons";

function Row({ title, detail, onClick, danger, disabled, end }: { icon?: string; title: string; detail?: ReactNode; sub?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; end?: ReactNode }) {
  return (
    <button type="button" className={`row line-row ${danger ? "is-danger" : ""}`} onClick={onClick} disabled={disabled}>
      <span className="row-text">
        <span className="row-title">{title}</span>
      </span>
      {detail != null && <span className="row-detail">{detail}</span>}
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
          <h2>{group.name}</h2>
        </div>
        <div className="panel list">
          <Row title="Invite code" detail={<span className="c-accent">{group.invite_code}</span>} onClick={onCopyCode} end={<span className="text-btn">Copy</span>} />
          <Row title="Weekly budget" detail={`EGP ${egp(weeklyBudget)}`} onClick={onBudget} />
        </div>
      </section>

      <section className="stack-tight">
        <div className="section-head">
          <h2>Automation</h2>
        </div>
        <div className="panel list">
          <Row title="Auto-log from receipts" onClick={onShortcut} />
          {nativeApp && (
            <Row
              title="Ride notifications"
              detail={notificationPermission === "granted" ? <span className="c-good">On</span> : "Off"}
              onClick={onNotifications}
            />
          )}
          {cloud && signedIn && <Row title={ntfyTesting ? "Sending" : "Send test alert"} onClick={onNtfyTest} disabled={ntfyTesting} />}
        </div>
      </section>

      {cloud && (
        <section className="stack-tight">
          <div className="section-head">
            <h2>Account</h2>
          </div>
          <div className="panel list">
            {signedIn && !nativeApp && <Row title="Face ID sign-in" detail={hasPasskey ? <span className="c-good">On</span> : "Off"} onClick={onPasskey} />}
            {signedIn && !nativeApp && hasPasskey && <Row title="Remove Face ID" onClick={onRemovePasskey} />}
            {signedIn ? (
              <Row title="Sign out" detail={email ?? currentName} onClick={onSignOut} danger end={<span />} />
            ) : (
              <Row title="Sign in with Google" onClick={onSignIn} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
