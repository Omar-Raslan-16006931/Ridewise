import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const directions = new Set(["campus", "home"]);
const tripModes = new Set(["shared", "solo"]);

type TripRequest = {
  amount?: unknown;
  direction?: unknown;
  trip_mode?: unknown;
  mode?: unknown;
  solo_by?: unknown;
  rider?: unknown;
  paid_by?: unknown;
  notes?: unknown;
  ride_at?: unknown;
  group_id?: unknown;
  created_by?: unknown;
};

function unauthorized() {
  return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
}

function hasValidApiKey(request: Request) {
  const expected = process.env.RIDEWISE_SHORTCUT_API_KEY;
  const received = request.headers.get("x-ridewise-api-key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/trips",
    method: "POST",
    authentication: "x-ridewise-api-key",
    fields: {
      amount: "number",
      mode: "shared | solo",
      direction: "campus | home",
      rider: "profile UUID for solo rides",
      paid_by: "profile UUID, optional when the shortcut user is configured",
      notes: "optional string",
      ride_at: "optional ISO timestamp",
    },
  });
}

export async function POST(request: Request) {
  if (!hasValidApiKey(request)) return unauthorized();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Shortcut API is not configured on the server" }, { status: 503 });
  }

  let body: TripRequest;
  try {
    body = (await request.json()) as TripRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const amount = Number(body.amount);
  const direction = String(body.direction ?? "home");
  const tripMode = String(body.trip_mode ?? body.mode ?? "shared");
  const shortcutUserId = process.env.RIDEWISE_SHORTCUT_USER_ID;
  const groupId = String(body.group_id ?? process.env.RIDEWISE_SHORTCUT_GROUP_ID ?? "");
  const riderId = String(body.solo_by ?? body.rider ?? (tripMode === "solo" ? shortcutUserId ?? "" : ""));
  const payerId = String(body.paid_by ?? (tripMode === "solo" ? riderId : shortcutUserId ?? ""));
  const createdBy = String(body.created_by ?? shortcutUserId ?? payerId);
  const notes = body.notes == null ? null : String(body.notes).trim();
  const rideAt = body.ride_at ? new Date(String(body.ride_at)) : new Date();

  if (!Number.isFinite(amount) || amount <= 0 || amount >= 100000) return NextResponse.json({ error: "amount must be between 0 and 100000" }, { status: 400 });
  if (!directions.has(direction)) return NextResponse.json({ error: "direction must be campus or home" }, { status: 400 });
  if (!tripModes.has(tripMode)) return NextResponse.json({ error: "mode must be shared or solo" }, { status: 400 });
  if (!groupId || !createdBy || !payerId || (tripMode === "solo" && !riderId)) return NextResponse.json({ error: "group_id, created_by, paid_by, and solo rider are required" }, { status: 400 });
  if (notes && notes.length > 280) return NextResponse.json({ error: "notes must be 280 characters or fewer" }, { status: 400 });
  if (Number.isNaN(rideAt.getTime())) return NextResponse.json({ error: "ride_at must be a valid ISO timestamp" }, { status: 400 });

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: members, error: membersError } = await supabase.from("ride_group_members").select("user_id").eq("group_id", groupId);
  if (membersError) return NextResponse.json({ error: membersError.message }, { status: 500 });
  const memberIds = new Set((members ?? []).map((member) => member.user_id));
  if (!memberIds.has(createdBy) || !memberIds.has(payerId) || (tripMode === "solo" && !memberIds.has(riderId))) {
    return NextResponse.json({ error: "All trip users must belong to the ride group" }, { status: 400 });
  }

  const { data: trip, error } = await supabase.from("ride_trips").insert({
    group_id: groupId,
    ride_at: rideAt.toISOString(),
    direction,
    amount,
    trip_mode: tripMode,
    solo_by: tripMode === "solo" ? riderId : null,
    paid_by: payerId,
    created_by: createdBy,
    notes,
  }).select("id,group_id,ride_at,direction,amount,trip_mode,solo_by,paid_by,created_by,notes").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trip }, { status: 201 });
}
