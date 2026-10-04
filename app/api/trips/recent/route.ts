import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { describeTrip } from "../../../../lib/ride-notifications";
import type { Member } from "../../../../lib/types";

export const dynamic = "force-dynamic";

const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Feed for the iOS app's background check: rides created after `since`.
 * Authenticated with the space invite code, the same way POST /api/trips is.
 * Returns ready-made notification text so the on-device script stays tiny.
 */
export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Supabase service role key is not configured on the server" }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const groupCode = String(request.headers.get("x-ridewise-group-code") ?? params.get("group_code") ?? "")
    .trim()
    .toUpperCase();
  if (!groupCode) return NextResponse.json({ error: "group code required" }, { status: 401 });

  const now = new Date();
  const oldestAllowed = new Date(now.getTime() - MAX_LOOKBACK_MS);
  const rawSince = String(params.get("since") ?? "").trim();
  const parsedSince = new Date(rawSince);
  // Keep the caller's exact string when valid: Postgres timestamps carry microseconds.
  const since = rawSince && !isNaN(parsedSince.getTime()) && parsedSince > oldestAllowed ? rawSince : oldestAllowed.toISOString();

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: group, error: groupError } = await supabase
    .from("ride_groups")
    .select("id")
    .eq("invite_code", groupCode)
    .maybeSingle();
  if (groupError) return NextResponse.json({ error: groupError.message }, { status: 500 });
  if (!group) return NextResponse.json({ error: "Invalid group code" }, { status: 401 });

  const [membersResult, tripsResult] = await Promise.all([
    supabase.from("ride_group_members").select("user_id,display_name").eq("group_id", group.id),
    supabase
      .from("ride_trips")
      .select("id,amount,direction,trip_mode,paid_by,notes,created_at")
      .eq("group_id", group.id)
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(20),
  ]);
  if (tripsResult.error) return NextResponse.json({ error: tripsResult.error.message }, { status: 500 });

  const members = (membersResult.data ?? []) as Member[];
  const trips = (tripsResult.data ?? []).map((trip) => ({
    id: trip.id as string,
    created_at: trip.created_at as string,
    ...describeTrip({ ...trip, amount: Number(trip.amount) }, members),
  }));

  return NextResponse.json({ now: now.toISOString(), trips }, { headers: { "Cache-Control": "no-store" } });
}
