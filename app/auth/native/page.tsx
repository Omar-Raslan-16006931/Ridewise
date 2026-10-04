"use client";

import { useEffect, useState } from "react";

/**
 * Landing page for Google sign-in started from the iOS app.
 * Supabase redirects here inside the system browser sheet; this page passes the
 * session on to the app through its ridewise:// URL scheme.
 */
export default function NativeAuthReturn() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    const url = `ridewise://auth${window.location.search}${window.location.hash}`;
    setTarget(url);
    window.location.replace(url);
  }, []);

  return (
    <main className="loading-screen" style={{ padding: "24px", textAlign: "center" }}>
      <div className="loader" />
      <p>Signed in. Returning to Ridewise…</p>
      {target && (
        <a className="sheet-submit-btn" style={{ textDecoration: "none", padding: "0 22px", display: "inline-flex", alignItems: "center" }} href={target}>
          Open Ridewise
        </a>
      )}
    </main>
  );
}
