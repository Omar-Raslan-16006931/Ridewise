/**
 * Helpers for the iOS app build (Capacitor).
 * Every function is a safe no-op in a normal browser.
 */
import { Capacitor } from "@capacitor/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Must match BackgroundRunner.label in capacitor.config.json and Info.plist. */
const RUNNER_LABEL = "com.omar.ridewise.ridecheck";
/** Custom URL scheme registered in ios/App/App/Info.plist. */
export const NATIVE_URL_SCHEME = "ridewise";
export const NATIVE_AUTH_PATH = "/auth/native";

export type NotificationPermission = "granted" | "denied" | "prompt" | "unsupported";

export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!isNativeApp()) return "unsupported";
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const status = await LocalNotifications.checkPermissions();
    return status.display === "granted" ? "granted" : status.display === "denied" ? "denied" : "prompt";
  } catch {
    return "unsupported";
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNativeApp()) return "unsupported";
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const status = await LocalNotifications.requestPermissions();
    return status.display === "granted" ? "granted" : status.display === "denied" ? "denied" : "prompt";
  } catch {
    return "unsupported";
  }
}

/** Fires a real notification a few seconds from now so it can be seen with the app closed. */
export async function sendTestNotification(delaySeconds = 6): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.floor(Date.now() % 2000000000),
          title: "Ride auto-logged",
          body: "EGP 120 · to campus · shared · test notification",
          schedule: { at: new Date(Date.now() + delaySeconds * 1000), allowWhileIdle: true },
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Tells the background check which space to watch and what this phone has already seen.
 * `lastSeen` is the newest `created_at` the app has loaded, so rides already on screen
 * are never notified again. Pass `groupCode: ""` on sign-out to stop the checks.
 */
export function syncBackgroundCheck(state: { groupCode: string; lastSeen: string | null }): void {
  if (!isNativeApp()) return;
  void (async () => {
    try {
      const { BackgroundRunner } = await import("@capacitor/background-runner");
      // Not awaited on purpose: the runner may not resolve while the app is in the foreground.
      void BackgroundRunner.dispatchEvent({
        label: RUNNER_LABEL,
        event: "syncState",
        details: {
          apiBase: window.location.origin,
          groupCode: state.groupCode,
          lastSeen: state.lastSeen ?? new Date().toISOString(),
        },
      }).catch(() => undefined);
    } catch {
      // Background checks are best-effort.
    }
  })();
}

/**
 * Google blocks sign-in inside embedded web views, so the app opens the system
 * browser sheet, and /auth/native hands the session back through ridewise://auth.
 */
export async function signInWithGoogleNative(supabase: SupabaseClient): Promise<string | null> {
  const { Browser } = await import("@capacitor/browser");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}${NATIVE_AUTH_PATH}`, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return error?.message ?? "Could not start Google sign-in";
  await Browser.open({ url: data.url, presentationStyle: "popover" });
  return null;
}

/** Listens for ridewise://auth#access_token=...&refresh_token=... and signs the app in. */
export function listenForNativeAuth(
  supabase: SupabaseClient,
  onResult: (error: string | null) => void
): () => void {
  if (!isNativeApp()) return () => undefined;
  let remove: (() => void) | null = null;
  let cancelled = false;

  void (async () => {
    const [{ App }, { Browser }] = await Promise.all([import("@capacitor/app"), import("@capacitor/browser")]);
    const handle = await App.addListener("appUrlOpen", async ({ url }) => {
      if (!url.toLowerCase().startsWith(`${NATIVE_URL_SCHEME}://auth`)) return;
      void Browser.close().catch(() => undefined);
      const fragment = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
      const query = url.includes("?") ? url.slice(url.indexOf("?") + 1).split("#")[0] : "";
      const params = new URLSearchParams(fragment || query);
      const failure = params.get("error_description") ?? new URLSearchParams(query).get("error_description");
      if (failure) return onResult(failure.replace(/\+/g, " "));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (!accessToken || !refreshToken) return onResult("Sign-in did not return a session. Please try again.");
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      onResult(error ? error.message : null);
    });
    if (cancelled) void handle.remove();
    else remove = () => void handle.remove();
  })();

  return () => {
    cancelled = true;
    remove?.();
  };
}
