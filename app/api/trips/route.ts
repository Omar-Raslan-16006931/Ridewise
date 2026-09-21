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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Supabase is not configured on the server" }, { status: 503 });
  }

  let body: any;
  try {
    body = (await request.json()) as any;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const hasApiKey = hasValidApiKey(request);
  const groupCode = String(body.group_code ?? request.headers.get("x-ridewise-group-code") ?? "").trim().toUpperCase();

  if (!hasApiKey && !groupCode) {
    return unauthorized();
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  let groupId = String(body.group_id ?? process.env.RIDEWISE_SHORTCUT_GROUP_ID ?? "");
  if (!groupId && groupCode) {
    const { data: groupData, error: groupErr } = await supabase
      .from("ride_groups")
      .select("id")
      .eq("invite_code", groupCode)
      .maybeSingle();

    if (groupErr || !groupData) {
      return NextResponse.json({ error: "Invalid group code" }, { status: 401 });
    }
    groupId = groupData.id;
  }

  if (!groupId) {
    return NextResponse.json({ error: "group_id or group_code is required" }, { status: 400 });
  }

  // Fetch members to resolve payer name / IDs
  const { data: members, error: membersError } = await supabase
    .from("ride_group_members")
    .select("user_id,display_name")
    .eq("group_id", groupId);

  if (membersError || !members || members.length === 0) {
    return NextResponse.json({ error: "Group members not found" }, { status: 404 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 100000) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }

  // Direction: campus or home (default by time of day)
  let direction = String(body.direction ?? "").toLowerCase().trim();
  if (!directions.has(direction)) {
    direction = new Date().getHours() < 13 ? "campus" : "home";
  }

  // Mode: shared or solo
  const tripMode = String(body.trip_mode ?? body.mode ?? "shared").toLowerCase().trim();
  if (!tripModes.has(tripMode)) {
    return NextResponse.json({ error: "mode must be shared or solo" }, { status: 400 });
  }

  // Resolve payer by ID or display name
  const rawPayer = String(body.paid_by ?? body.rider ?? "").trim();
  let matchedMember = members.find(
    (m) => m.user_id === rawPayer || m.display_name.toLowerCase() === rawPayer.toLowerCase()
  );

  if (!matchedMember && members.length > 0) {
    matchedMember = members[0];
  }

  if (!matchedMember) {
    return NextResponse.json({ error: "Valid payer member required" }, { status: 400 });
  }

  const payerId = matchedMember.user_id;
  const riderId = tripMode === "solo" ? payerId : null;
  const createdBy = payerId;
  const notes = body.notes ? String(body.notes).trim().slice(0, 280) : "Logged via iOS Shortcut";
  const rideAt = body.ride_at ? new Date(String(body.ride_at)) : new Date();

  const { data: trip, error } = await supabase.from("ride_trips").insert({
    group_id: groupId,
    ride_at: rideAt.toISOString(),
    direction,
    amount,
    trip_mode: tripMode,
    solo_by: riderId,
    paid_by: payerId,
    created_by: createdBy,
    notes,
  }).select("id,group_id,ride_at,direction,amount,trip_mode,solo_by,paid_by,created_by,notes").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, trip }, { status: 201 });
}
