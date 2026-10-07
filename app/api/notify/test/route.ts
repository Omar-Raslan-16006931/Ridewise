import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { sendNtfy } from "../../../../lib/ntfy";

export const dynamic = "force-dynamic";

/** Sends a test ntfy push. Only signed-in users can call it, so nobody else can spam the topic. */
export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase is not configured on the server" }, { status: 503 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  if (!process.env.NTFY_TOPIC?.trim()) {
    return NextResponse.json({ error: "NTFY_TOPIC is not set on Vercel (add it, then redeploy)." }, { status: 503 });
  }

  const sent = await sendNtfy({ title: "Ridewise test", body: "ntfy is working. New rides will show up like this." });
  if (!sent) return NextResponse.json({ error: "ntfy did not accept the message. Check NTFY_TOPIC, NTFY_SERVER and NTFY_TOKEN." }, { status: 502 });
  return NextResponse.json({ sent: true });
}
