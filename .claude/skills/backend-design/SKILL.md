---
name: backend-design
description: Guardrails and workflow for building Find Fundi's backend — Node.js/Express API on top of Supabase (Postgres + Auth). Use whenever writing backend code, designing API endpoints, database schema, or auth flow for this project. Companion to the frontend-design rules in CLAUDE.md.
metadata:
  owner: Ricky Ngigi
  version: "1.0.0"
---

# Find Fundi — Backend Design Rules

## Always Do First
- Read this skill before writing any backend code, every session, no exceptions — same rule the frontend side already follows for `frontend-design`.
- Check for an existing `.env` / `.env.example` and existing `src/` structure before assuming nothing is set up yet.

## Stack (fixed — do not swap without asking)
- **Runtime:** Node.js + Express.
- **Database:** Supabase (hosted Postgres).
- **Auth:** Supabase Auth — do not hand-roll password hashing, session tokens, or JWT issuance.
- **Storage (if needed):** Supabase Storage, not a separate S3 bucket, unless asked.

## Project Structure
- `src/server.js` — entrypoint, app wiring only (no route logic inline).
- `src/routes/` — one file per resource (e.g. `fundis.js`, `bookings.js`), thin — just wiring HTTP verbs to controllers.
- `src/controllers/` — request/response handling, calls services, no direct DB queries here.
- `src/services/` — business logic + Supabase queries live here.
- `src/db/` — Supabase client init, migrations/schema if not managed purely through the Supabase dashboard/CLI.
- `src/middleware/` — auth guard, error handler, validation.

## API Conventions
- REST, JSON in/out, versioned under `/api/v1/...`.
- Resource-based routes (`/api/v1/fundis`, `/api/v1/bookings`), plural nouns, no verbs in the path.
- Every error response shares one shape: `{ "error": { "message": string, "code": string } }`. Never leak raw Postgres/Supabase error objects to the client.
- Every success response is `{ "data": ... }` (or paginated: `{ "data": [...], "meta": { "page", "pageSize", "total" } }`).

## Database Rules
- `snake_case` for tables and columns; plural table names (`fundis`, `bookings`, `reviews`).
- Every table gets a UUID primary key, `created_at`/`updated_at` timestamps.
- Real foreign keys and constraints — no implicit relationships enforced only in application code.
- Schema changes go through Supabase migrations (tracked, reviewable) — never hand-edit prod schema through the dashboard for anything beyond quick prototyping.

## Security (non-negotiable)
- The Supabase **service role key** never reaches the frontend or a public repo — server-side only, from environment variables.
- The frontend talks to Supabase either through this Express API, or with the public **anon key** plus Row Level Security policies — never the service key.
- Validate and sanitize all input at the controller/middleware layer before it reaches a service.
- Rate-limit public-facing endpoints (signup, login, search).
- Secrets live in `.env`, which is git-ignored; `.env.example` documents required keys with no real values.

## Domain Shape (starting point — confirm/refine together before locking in)
Likely core entities for a fundi-matching marketplace: `fundis` (service providers), `clients`, `bookings`/`jobs`, `reviews`, `skills`/`categories`, and a join table linking fundis to skills. Treat this as a draft, not a spec — nail down the actual schema collaboratively before generating migrations.

## Hard Rules
- No hand-rolled auth (password hashing, token signing) — Supabase Auth handles it.
- No direct DB calls from route or controller files — only from `services/`.
- No raw SQL string concatenation — use the Supabase client's query builder or parameterized queries.
- No committing `.env` or any real Supabase keys.
- Don't add endpoints, tables, or fields beyond what's been discussed — same "match what's agreed, don't embellish" spirit as the frontend rules.
