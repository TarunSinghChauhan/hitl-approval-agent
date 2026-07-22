# Human-in-the-Loop Approval Agent

An agent that assesses its own confidence before acting. High-confidence
tasks execute automatically. Low-confidence, ambiguous, or irreversible
tasks pause and wait for a human to approve or reject — with a full
audit trail of every state transition.

## Why this exists

Most agent demos show what an LLM can do on its own. This one shows the
part that actually matters in production: knowing when **not** to act
alone, and providing a compliance-grade record of what happened and who
approved it.

## Architecture

```
submit task
   │
   ▼
agent assesses (proposed action + reasoning + confidence 0-1)
   │
   ├── confidence >= 0.75 ──► auto-execute ──► COMPLETED
   │
   └── confidence <  0.75 ──► PENDING_APPROVAL (persisted to DB, agent stops)
                                  │
                          human reviews in dashboard
                                  │
                     ┌────────────┴────────────┐
                     ▼                          ▼
                 APPROVE                     REJECT
                     │                          │
              execute action              REJECTED (nothing runs)
                     │
               COMPLETED
```

Every transition is appended to an `auditLog` JSON array on the task
record: who/what triggered it, when, and why.

**Important design note:** this is built stateless-by-design. Vercel
serverless functions don't stay alive waiting for a human to click a
button — so "pause" here means *persist state to the database and return*,
and "resume" means *a fresh function call reads that state back*. That's
not a workaround, it's the correct pattern for this kind of system even
outside serverless constraints.

## Stack

- Next.js 14 (App Router) — frontend + API routes
- Prisma — ORM, SQLite locally / Postgres in production
-  Groq — LLM calls, free tier (no card required, rate-limited not billed)

## Run locally

```bash
npm install
cp .env.example .env
# edit .env and add your free OpenRouter key from https://openrouter.ai/keys

npx prisma db push   # creates the local SQLite database
npm run dev
```

Open http://localhost:3000, submit a task, and watch it either
auto-complete or land in the approval queue.

Try both paths:
- **High confidence** (auto-executes): "Summarize this paragraph in one sentence: ..."
- **Low confidence** (pauses for approval): "Delete all inactive user accounts older than 2 years" or "Send a refund to this customer"

## Deploy to Vercel (free)

SQLite's file lives on ephemeral disk in serverless functions — it will
**not** persist between invocations on Vercel. Swap to a free Postgres
before deploying:

1. Create a free Postgres database at [neon.tech](https://neon.tech) or
   [supabase.com](https://supabase.com) and copy the connection string.
2. In `prisma/schema.prisma`, change:
   ```prisma
   datasource db {
     provider = "postgresql"   // was "sqlite"
     url      = env("DATABASE_URL")
   }
   ```
3. Push to GitHub, import the repo on [vercel.com](https://vercel.com).
4. In Vercel's project settings → Environment Variables, add:
   - `DATABASE_URL` — your Postgres connection string
   - `GROQ_API_KEY` — your free Groq key from https://console.groq.com/keys
   - `GROQ_MODEL` — e.g. `llama-3.3-70b-versatile`
5. Deploy. Vercel runs `prisma generate` automatically via the
   `postinstall` script; run `npx prisma db push` once locally against
   the production `DATABASE_URL` to create the tables.

No paid API key required anywhere in this stack.

## What to say about this in an interview

- Why the confidence threshold lives in code, not in the prompt (a
  single reviewable number vs. relying on the model to "decide" to ask)
- Why state is persisted rather than held in memory — the same pattern
  a real distributed system needs, not just a serverless workaround
- What the audit log is for: not just debugging, but literally the
  artifact a compliance review would ask for
- What you'd add next: role-based approval (not just "any human"),
  timeout/escalation if nobody approves, and a configurable threshold
  per task category instead of one global number
