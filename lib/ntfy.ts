/**
 * Instant phone alerts through ntfy (https://ntfy.sh).
 * Server-only. Does nothing unless NTFY_TOPIC is set.
 *
 *   NTFY_TOPIC   topic the phones subscribe to in the ntfy app (keep it hard to guess)
 *   NTFY_SERVER  optional, defaults to https://ntfy.sh (set for a self-hosted server)
 *   NTFY_TOKEN   optional access token for protected topics
 */
export async function sendNtfy(notification: { title: string; body: string }): Promise<boolean> {
  const topic = process.env.NTFY_TOPIC?.trim();
  if (!topic) return false;

  const server = (process.env.NTFY_SERVER?.trim() || "https://ntfy.sh").replace(/\/+$/, "");
  const token = process.env.NTFY_TOKEN?.trim();
  const appUrl = process.env.RIDEWISE_APP_URL?.trim() || "https://ubershareride.vercel.app";

  try {
    // JSON publishing keeps non-ASCII text (the "·" separators, Arabic names) intact.
    const response = await fetch(server, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        topic,
        title: notification.title,
        message: notification.body,
        tags: ["oncoming_taxi"],
        click: appUrl,
      }),
      // A slow ntfy server must never hold up or fail the ride being logged.
      signal: AbortSignal.timeout(4000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
