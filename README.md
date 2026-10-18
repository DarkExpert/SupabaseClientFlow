# SupabaseClientFlow

A small public portfolio demo: FAQ-grounded AI support, saved conversations, a human support request flag, and fixed appointment booking. The frontend is React, TypeScript, and Vite in `web/`; Supabase provides anonymous Auth, Postgres, RLS, and one Edge Function.

## Setup

1. Create a Supabase project and enable **Anonymous Sign-Ins** in Authentication. For local Supabase, `supabase/config.toml` enables this too.
2. Apply `supabase/migrations/20261013213000_create_faq.sql` only if the FAQ table is absent. Apply `supabase/migrations/20261018120000_demo_data.sql` after the FAQ exists. Use the SQL Editor or a reviewed migration workflow. The remote migration history may differ from these files; inspect tables and history before using `db push`. Do not reset the database.
3. Copy `web/.env.example` to `web/.env.local` and fill in your project URL and publishable key. This key is intended for browsers. Never put service-role or OpenAI keys in Vite environment files.
4. Set the Edge Function secrets `OPENAI_API_KEY`, `OPENAI_MODEL`, and `CLIENTFLOW_ALLOWED_ORIGIN` (your exact frontend origin). Supabase provides `SUPABASE_URL` and a server secret (`SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEYS`) to the function. Do not expose the server secret to the browser.
5. Deploy: `npx supabase functions deploy clientflow-chat --project-ref mihnplbsrkrpniizfxcv --use-api` (replace the ref for another project). The function config sets `verify_jwt = false` because the function validates the bearer token with `auth.getUser(token)` before any paid AI request.
6. Run `cd web`, `npm install`, `npm run dev`. Use `npm run lint` and `npm run build` for frontend checks.

For the included project ref, both the FAQ and demo schema have already been applied through SQL, and the function has been deployed. The remote schema was verified against both local migration files, then the two versions were marked applied in migration history without replaying SQL.
The React frontend is not publicly hosted as part of this repository release; run it locally or deploy it separately and set `CLIENTFLOW_ALLOWED_ORIGIN` to that origin.

## Data and security

`clientflow_conversations` and `clientflow_messages` are readable only by their owner through RLS. Browser clients can request a handoff by updating only `handoff_requested`; they cannot insert messages or change message roles. The Edge Function validates the session, checks conversation ownership, and uses server-only RPCs to reserve a quota and save each turn. The quota is **20 new AI requests per authenticated user per UTC day**, enforced in PostgreSQL. Duplicate request IDs do not consume more quota or create extra messages. Failed AI requests leave the user's message in history, with no assistant response. Browser sessions can be recovered after refresh, but anonymous session data will be lost if the browser clears its local storage.

`clientflow_book_slot` uses an authenticated database RPC and a unique `slot_id` constraint. Only one booking can succeed per slot, including simultaneous requests. A caller can read only their own booking rows. The availability view exposes slot IDs only, never another user's booking details. The migration seeds four fixed future slots; add new future timestamps to `clientflow_slots` when these pass.

## Verification after applying the migration

Use two independent anonymous browser sessions. Send a message in one, refresh, and confirm it is restored. Try reading that conversation ID from the other session: it should return no rows. Try inserting an assistant message from the browser: permission should be denied. Book the same slot from both sessions: exactly one should succeed. Verify a missing or invalid bearer token returns 401 from the Edge Function and does not call OpenAI. Simulate an AI failure and confirm no assistant message or booking confirmation appears. Check the 21st new AI request for one user on a UTC day returns the quota error. These checks require the remote migration and function deployment; frontend lint/build alone cannot prove hosted RLS or RPC behavior.

## Lovable reuse

The components can be adapted for a Lovable project connected to Supabase. Copy the chat and booking components and the session helper, update the styling, and configure the same public Vite variables. Apply and review the SQL migration in that project's Supabase database, deploy the Edge Function, and set its server secrets. Keep service-role and OpenAI keys out of Lovable client code. This reuse path is guidance; a Lovable integration has not been tested.

## Scope

This is a demo. A handoff request only stores a flag; it does not notify a human. Booking stores a database row and does not create calendar events or send email. There are no payments, CRM, WhatsApp, or production support workflows. The simple per-user quota is suitable for a small hosted demo; anonymous users can create new identities, so a production service needs stronger abuse controls.
Operator dashboards, notifications, calendar and payment integrations, and client-specific customization are future work, not features of this release.
