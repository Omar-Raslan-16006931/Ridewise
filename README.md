# Ridewise

A shared Uber ledger for two people: record a one-way ride, say who paid, and settle that exact half later.

## Set up Supabase

1. Create a Supabase project, then run [`supabase/schema.sql`](./supabase/schema.sql) in its SQL Editor.
2. In Supabase Auth, enable Email / Magic Link and add your Vercel URL to the Redirect URLs list.
3. Copy `.env.local.example` to `.env.local` and fill in the Project URL and publishable key from Supabase Connect.
4. Run `npm install`, then `npm run dev`.

## Deploy to Vercel

Import the `uber-split` folder as the project root, add the two `NEXT_PUBLIC_SUPABASE_*` variables, and deploy. Do not add a Supabase service-role key: the browser only needs the publishable key and database RLS protects the data.

## How sharing works

The first person signs in, creates a space, and sends the eight-character invite code to the other person. Both people can then add, correct, and settle trips. Each ride is automatically split 50/50; a settled ride is excluded from the amount owed.
