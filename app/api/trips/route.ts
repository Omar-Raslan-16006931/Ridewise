import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { parseReceiptEmail, type ParsedReceipt } from "../../../lib/receipt-parser";
import { tripNotification } from "../../../lib/ride-notifications";
import { sendNtfy } from "../../../lib/ntfy";
import { pickField, resolvePayer } from "../../../lib/payer";

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
    authentication: "group_code (body) or x-ridewise-api-key (header)",
    fields: {
      group_code: "string (required, your invite code from Space tab)",
      amount: "number (optional if email_body is provided)",
      email_body: "string (optional, paste or pipe raw Uber/DiDi receipt email)",
      subject: "string (optional, email subject line for provider context)",
      mode: "shared | solo (default 'shared')",
      direction: "campus | home (auto-detected if omitted)",
      paid_by: "string (profile UUID or display name, optional)",
      notes: "string (optional)",
      ride_at: "ISO timestamp (auto-detected from receipt if omitted)",
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
  const groupCode = String(
    body.group_code ??
      body.groupCode ??
      body.code ??
      body.invite_code ??
      request.headers.get("x-ridewise-group-code") ??
      ""
  )
    .trim()
    .toUpperCase();

  if (!hasApiKey && !groupCode) {
    return unauthorized();
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Support parsing raw email text or HTML receipts (Uber, DiDi, Careem, etc.)
  const rawEmail = body.email_body ?? body.email ?? body.raw_email ?? body.receipt ?? body.text;
  let parsedReceipt: ParsedReceipt | null = null;
  if (rawEmail && typeof rawEmail === "string") {
    parsedReceipt = parseReceiptEmail(rawEmail, {
      subject: body.subject ?? body.email_subject ?? "",
      emailDate: body.email_date ?? body.date,
    });
  }

  const rawAmount = body.amount ?? body.fare ?? body.cost ?? parsedReceipt?.amount;
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 100000) {
    return NextResponse.json({
      error: parsedReceipt
        ? `Could not detect ride amount from ${parsedReceipt.service} receipt. Please provide 'amount'.`
        : "amount must be a positive number under 100,000",
    }, { status: 400 });
  }

  // Direction: campus or home (default from receipt or Cairo time of day)
  let direction = String(body.direction ?? parsedReceipt?.direction ?? "").toLowerCase().trim();
  if (!directions.has(direction)) {
    direction = new Date().getHours() < 13 ? "campus" : "home";
  }

  // Mode: shared or solo
  const tripMode = String(body.trip_mode ?? body.mode ?? body.type ?? "shared").toLowerCase().trim();
  if (!tripModes.has(tripMode)) {
    return NextResponse.json({ error: "trip_mode must be 'shared' or 'solo'" }, { status: 400 });
  }

  // Who paid: accept the common spellings of the field, in the JSON body or the URL query.
  const payerFields = ["paid_by", "payer", "who_paid", "who", "paid", "rider"];
  const rawPayer =
    pickField(body, payerFields) || pickField(Object.fromEntries(new URL(request.url).searchParams), payerFields);

  const defaultNote = parsedReceipt ? parsedReceipt.notes : "Logged via iOS Shortcut";
  const notes = body.notes ? String(body.notes).trim().slice(0, 280) : defaultNote;

  const rideAtStr = body.ride_at ?? parsedReceipt?.ride_at;
  const rideAt = rideAtStr ? new Date(String(rideAtStr)) : new Date();
  const validRideAt = isNaN(rideAt.getTime()) ? new Date() : rideAt;

  const receiptSummary = parsedReceipt
    ? { service: parsedReceipt.service, amount, direction, ride_at: validRideAt.toISOString() }
    : undefined;
  const summary = { amount, direction: direction as "campus" | "home", trip_mode: tripMode as "shared" | "solo", notes };

  // Fallback for projects without a working service-role key: the log_shortcut_trip
  // database function. It matches the payer itself, so `payer` should be a profile UUID
  // whenever we already know it. Returns null when the function is not usable.
  async function logViaDatabaseFunction(payer: string | null) {
    if (!groupCode) return null;
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc("log_shortcut_trip", {
        p_group_code: groupCode,
        p_amount: amount,
        p_trip_mode: tripMode,
        p_payer: payer,
        p_notes: notes,
        p_direction: direction,
      });
      if (rpcError || !rpcData) return null;
      if (rpcData.error || rpcData.success === false) {
        return NextResponse.json({ error: rpcData.error }, { status: 400 });
      }
      const notification = tripNotification(summary, rpcData.trip?.paid_by);
      const pushed = await sendNtfy(notification);
      return NextResponse.json(
        { success: true, trip: rpcData.trip, notification, ntfy_sent: pushed, parsed_receipt: receiptSummary },
        { status: 201 }
      );
    } catch {
      return null;
    }
  }

  const isPermissionError = (err: { code?: string; message?: string } | null) =>
    Boolean(err && (err.code === "42501" || err.message?.includes("permission denied")));
  const permissionDenied = () =>
    NextResponse.json(
      {
        error:
          "Database permission denied (RLS). Please add SUPABASE_SERVICE_ROLE_KEY to your Vercel Environment Variables, or run the SQL function from the shortcut modal in Supabase SQL editor.",
      },
      { status: 500 }
    );

  // Without the service-role key the tables are locked by RLS, so go straight to the database function.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const logged = await logViaDatabaseFunction(rawPayer || null);
    if (logged) return logged;
  }

  // Main path: look the space and its members up, so the payer is matched here and never guessed.
  let groupId = String(body.group_id ?? process.env.RIDEWISE_SHORTCUT_GROUP_ID ?? "");
  if (groupCode) {
    const { data: groupData, error: groupErr } = await supabase
      .from("ride_groups")
      .select("id")
      .eq("invite_code", groupCode)
      .maybeSingle();

    if (groupErr) {
      if (isPermissionError(groupErr)) return (await logViaDatabaseFunction(rawPayer || null)) ?? permissionDenied();
      return NextResponse.json({ error: groupErr.message }, { status: 500 });
    }
    if (!groupData) {
      return NextResponse.json(
        { error: `Group code '${groupCode}' was not found. Please verify your invite code in the Space tab.` },
        { status: 404 }
      );
    }
    groupId = groupData.id;
  }

  if (!groupId) {
    return NextResponse.json({ error: "group_id or group_code is required" }, { status: 400 });
  }

  const { data: members, error: membersError } = await supabase
    .from("ride_group_members")
    .select("user_id,display_name")
    .eq("group_id", groupId)
    .order("joined_at");

  if (membersError) {
    if (isPermissionError(membersError)) return (await logViaDatabaseFunction(rawPayer || null)) ?? permissionDenied();
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }
  if (!members || members.length === 0) {
    return NextResponse.json({ error: "Group members not found" }, { status: 404 });
  }

  // A payer that was sent but matches nobody is an error. Quietly logging the ride
  // under the first member would put the debt on the wrong person.
  const matchedMember = rawPayer ? resolvePayer(rawPayer, members) : members[0];
  if (!matchedMember) {
    const names = members.map((member) => member.display_name.trim());
    return NextResponse.json(
      { error: `paid_by '${rawPayer}' does not match anyone in this space. Use one of: ${names.join(", ")}.`, members: names },
      { status: 400 }
    );
  }

  const payerId = matchedMember.user_id;
  const { data: trip, error } = await supabase
    .from("ride_trips")
    .insert({
      group_id: groupId,
      ride_at: validRideAt.toISOString(),
      direction,
      amount,
      trip_mode: tripMode,
      solo_by: tripMode === "solo" ? payerId : null,
      paid_by: payerId,
      created_by: payerId,
      notes,
    })
    .select("id,group_id,ride_at,direction,amount,trip_mode,solo_by,paid_by,created_by,notes")
    .single();

  if (error) {
    if (isPermissionError(error)) return (await logViaDatabaseFunction(payerId)) ?? permissionDenied();
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const notification = tripNotification(summary, matchedMember.display_name.trim());
  const pushed = await sendNtfy(notification);

  return NextResponse.json(
    {
      success: true,
      trip: { ...trip, paid_by_name: matchedMember.display_name.trim() },
      notification,
      ntfy_sent: pushed,
      parsed_receipt: receiptSummary,
    },
    { status: 201 }
  );
}
