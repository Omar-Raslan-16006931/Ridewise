# Ridewise

A shared Uber ledger for two people: record a one-way ride, say who paid, and settle that exact half later. Every ride and reimbursement is kept as its own permanent record, so lifetime, weekly, monthly, and custom-period totals remain accurate.

## Prerequisites

Use Node 22 LTS for local development and deployment (Vercel no longer builds with Node 20). Node 24 has not been tested with this project.

## Set up Supabase

1. Create a Supabase project, then run [`supabase/schema_v2.sql`](./supabase/schema_v2.sql) once in its SQL Editor. This is the final schema: it creates shared and solo trips, settlement history, access rules, and analytics functions. Do not run the old `schema.sql` for a new project.
   If an existing project returns `404` for `settle_ride_trip`, run [`supabase/migrate_settlement_paid_by.sql`](./supabase/migrate_settlement_paid_by.sql) once in the same SQL Editor.
2. In Supabase Auth, enable Email / Magic Link and add your Vercel URL to the Redirect URLs list.
3. Copy `.env.local.example` to `.env.local` and fill in the Project URL and publishable key from Supabase Connect.
4. Run `npm install`, then `npm run dev`.

## Deploy to Vercel

Import the `Ridewise` folder as the project root, add the variables below, and deploy with Node 22:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for the server-only Apple Shortcuts API. Never expose it with a `NEXT_PUBLIC_` prefix.
- `RIDEWISE_SHORTCUT_API_KEY` for authenticating Shortcut requests.
- `RIDEWISE_SHORTCUT_GROUP_ID` and `RIDEWISE_SHORTCUT_USER_ID` after the first group and member exist.

After deployment, verify the API route with `GET https://YOUR_DOMAIN/api/trips`. It returns the accepted fields without exposing secrets.

## How sharing works

The first person signs in, creates a space, and sends the eight-character invite code to the other person. Both people can then add, correct, and settle trips. Each ride is automatically split 50/50; when the other rider settles, a separate payment transaction is stored and that trip leaves the outstanding balance.

## Analytics captured

- Every trip: exact timestamp, direction, cost, Uber payer, editor, and note.
- Every settlement: the trip it clears, amount, sender, receiver, timestamp, and recorder.
- Lifetime, last seven days, and current-month totals: rides, active days, total spending, average fare, route mix, and how much each person paid.
- `public.ride_analytics(group_id, starts_at, ends_at)` is also available for reports with any custom date range.

## Deployment order

1. Run `supabase/schema_v2.sql` in a new Supabase project's SQL Editor.
2. In Supabase Auth, enable the Google provider. In Google Cloud, add `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as an authorized redirect URI for the Google OAuth client, then paste the Google client ID and secret into Supabase.
3. Add `https://YOUR_DOMAIN/**` to Supabase Auth redirect URLs.
4. Add the Supabase URL, publishable key, service-role key, and Shortcut API key to Vercel, then deploy.
5. Temporarily leave **Allow new users to sign up** enabled. Open Ridewise and sign in with Google as Omar using `fbertya@gmail.com`. Create the group.
6. Sign in with Google as Khaled using `khaldoonelmasry@gmail.com`, then join Omar's group with the invite code.
7. Confirm both members can see the same ledger. Then go to Supabase **Authentication > Providers / Settings** and disable **Allow new users to sign up**. This keeps the two existing Google accounts able to sign in while blocking future accounts.
8. In Supabase SQL Editor, get the IDs needed by the Shortcut:

```sql
select
	rg.id as group_id,
	rg.name,
	rg.invite_code,
	rgm.user_id,
	rgm.display_name
from public.ride_groups rg
join public.ride_group_members rgm on rgm.group_id = rg.id
order by rg.created_at desc, rgm.joined_at;
```

9. Add `RIDEWISE_SHORTCUT_GROUP_ID` and `RIDEWISE_SHORTCUT_USER_ID` to Vercel and redeploy.
10. Create the Apple Shortcut using the API request below.

## Apple Shortcuts API

The app exposes `POST /api/trips` for an iPhone Shortcut. Configure these server-only variables in Vercel or `.env.local`:

- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service-role key. Never expose this as a `NEXT_PUBLIC_*` variable.
- `RIDEWISE_SHORTCUT_API_KEY`: a long random secret used by the Shortcut in the `x-ridewise-api-key` header.
- `RIDEWISE_SHORTCUT_GROUP_ID`: the Ridewise group UUID.
- `RIDEWISE_SHORTCUT_USER_ID`: the profile UUID for the person using the Shortcut.

In Apple Shortcuts, use **Get Contents of URL** with method `POST`, header `x-ridewise-api-key`, and a JSON request body such as:

```json
{
	"amount": 500,
	"mode": "solo",
	"rider": "PROFILE_UUID",
	"direction": "home",
	"notes": "Airport ride"
}
```

For a shared ride, use `"mode": "shared"` and omit `rider`. The endpoint defaults `paid_by`, `created_by`, and the group from the configured Shortcut user and group.

## iOS app (sideloaded IPA)

The iPhone app is a thin native shell (Capacitor, in `ios/`) that opens the live site at `https://ubershareride.vercel.app`, so web changes reach the phone through Vercel without reinstalling.

- **Get the IPA:** GitHub → Actions → **Build iOS IPA** → latest run → download `Ridewise-ipa`, unzip it, and install `Ridewise.ipa` with Sideloadly or AltStore. The build is unsigned; the sideloading tool signs it with your Apple ID.
- **Rebuilds** run automatically when `ios/`, `native/`, `capacitor.config.json`, or `package.json` change on `main`, or manually from the Actions tab.
- **Sign-in:** Google sign-in opens in a Safari sheet and returns through `/auth/native` and the `ridewise://` URL scheme. Passkeys are hidden in the app because iOS only allows them in apps signed with a paid developer account.
- **Notifications:** `native/www/runners/ride-check.js` runs through iOS Background App Refresh, asks `GET /api/trips/recent` for rides created since the phone last looked, and shows a local notification for each. iOS chooses when it runs (usually within minutes to a couple of hours), and it stops if the app is swiped away in the app switcher or Background App Refresh is off. Instant push would need Apple's push service, which requires a paid developer account.
- `POST /api/trips` also returns `notification.title` and `notification.body`, which a Shortcut can pass to a **Show Notification** action for an instant alert on the phone that logged the ride.
