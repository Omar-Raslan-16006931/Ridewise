import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The build currently live on Vercel. Open copies of the app compare it with their own and reload when it changes. */
export function GET() {
  return NextResponse.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
