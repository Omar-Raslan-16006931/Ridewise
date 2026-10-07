import type { Member } from "./types";

/** Lowercases and strips quotes, invisible characters and extra spaces so "  Khaled\n" still matches. */
function clean(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[​-‏‪-‮⁠﻿]/g, "")
    .replace(/["'`“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Finds the group member a Shortcut / n8n request means by `paid_by`.
 * Accepts the profile UUID, the display name in any letter case, or one clear
 * part of it ("khaled" for "Khaled Elmasry"). Returns null when nobody, or more
 * than one member, fits, so the caller can refuse instead of guessing.
 */
export function resolvePayer(raw: string, members: Member[]): Member | null {
  const wanted = clean(raw);
  if (!wanted) return null;

  const byId = members.find((member) => member.user_id.toLowerCase() === wanted);
  if (byId) return byId;

  const exact = members.filter((member) => clean(member.display_name) === wanted);
  if (exact.length === 1) return exact[0];

  const partial = members.filter((member) => {
    const name = clean(member.display_name);
    if (!name) return false;
    return name.split(" ").includes(wanted) || name.startsWith(wanted) || wanted.startsWith(name) || wanted.split(" ").includes(name);
  });
  return partial.length === 1 ? partial[0] : null;
}

/** Reads a field from a request body whatever its spelling: paid_by, paidBy, "Paid By ", PAID-BY. */
export function pickField(source: Record<string, unknown> | null | undefined, names: string[]): string {
  if (!source || typeof source !== "object") return "";
  const squash = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = names.map(squash);
  for (const name of wanted) {
    for (const [key, value] of Object.entries(source)) {
      if (squash(key) !== name || value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return "";
}
