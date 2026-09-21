import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Supabase service role key is not configured on the server. Please add SUPABASE_SERVICE_ROLE_KEY to your Vercel Environment Variables." },
      { status: 500 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, email, userId, credentialId, secretToken } = body;

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (action === "register") {
    if (!email || !credentialId) {
      return NextResponse.json({ error: "Email and credentialId are required" }, { status: 400 });
    }

    if (userId) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          passkey_credential_id: credentialId,
          passkey_secret: secretToken,
          passkey_enrolled_at: new Date().toISOString(),
        },
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true });
  }

  if (action === "login") {
    if (!email) {
      return NextResponse.json({ error: "Email is required for Face ID sign in" }, { status: 400 });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Generate authenticated magiclink OTP for this user
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: cleanEmail,
    });

    if (error || !data?.properties?.hashed_token) {
      return NextResponse.json(
        { error: error?.message || "Could not authenticate this account" },
        { status: 400 }
      );
    }

    // Verify credential match if passkey was previously stored in user metadata
    if (data.user?.user_metadata?.passkey_credential_id && credentialId) {
      if (data.user.user_metadata.passkey_credential_id !== credentialId) {
        return NextResponse.json(
          { error: "Face ID passkey does not match this account. Please re-enroll in Settings." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      token_hash: data.properties.hashed_token,
      email: data.user?.email || cleanEmail,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

