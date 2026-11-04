# Human-in-the-Loop Approval Agent

An AI agent that assesses its own confidence before acting. High-confidence tasks execute automatically. Low-confidence, ambiguous, or irreversible tasks pause and wait for a human to approve or reject, with a full audit trail of every state transition.

**Live demo:** [hitl-approval-agent.vercel.app](https://hitl-approval-agent.vercel.app)

## Why this exists

Most agent demos show what an LLM can do on its own. This one shows the part that matters in production: knowing when **not** to act alone, and keeping a compliance-grade record of what happened and who approved it.

It also documents a real weakness in the design (see [Known Limitation](#known-limitation)), because understanding where a safety gate fails is as important as building it.

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

Every transition is appended to an `auditLog` JSON array on the task record: what triggered it, when, and why.

### Design decisions

- **The threshold lives in code, not in the prompt.** A single reviewable number (`0.75`) is easier to audit and change than asking the model to "decide" when to ask for help.
- **State is persisted, not held in memory.** Serverless functions don't stay alive waiting for a human to click a button. "Pause" means save state to the database and return. "Resume" means a fresh function call reads that state back. This is the correct pattern for any distributed system, not just a serverless workaround.
- **The audit log is a first-class artifact.** It is not just for debugging. It is what a compliance review would ask for.

## Stack

- **Next.js 14** (App Router): frontend and API routes
- **Prisma**: ORM. SQLite locally, PostgreSQL in production (see deploy notes)
- **Groq** (`llama-3.3-70b-versatile`): LLM calls on the free tier
- **Framer Motion / Lucide**: UI animation and icons

## Known Limitation

> **Status: not fixed. This is documented on purpose.**

The approval gate relies **only on the model's self-reported confidence**. There is no independent check of how risky the requested action is. So a high-risk request that is phrased politely or vaguely can get a high confidence score and auto-execute.

**Reproduction**

- **Prompt used:** `[PASTE THE EXACT PROMPT THAT SLIPPED THROUGH]`
- **Confidence returned:** `[e.g. 0.8]`
- **Result:** auto-executed instead of pausing for approval
- **Expected:** `PENDING_APPROVAL`, since the action is destructive or irreversible

**Why it happens:** confidence measures how sure the model is about *what the user wants*, not how dangerous the action is. A clearly worded request to do something destructive can still score as high-confidence.

**Proposed fixes** (not yet implemented)

1. **Per-category thresholds:** stricter limits for destructive categories (delete, refund, send) than for read-only ones (summarize).
2. **Independent risk check:** a rule-based or second-model classifier that forces approval for risky action types regardless of the confidence score.
3. **Role-based approval and escalation:** route high-risk tasks to specific approvers, with a timeout if nobody responds.

## Run locally

```bash
npm install
cp .env.example .env
# edit .env and add your free Groq key from https://console.groq.com/keys

npx prisma db push   # creates the local SQLite database
npm run dev
```

Open <http://localhost:3000>, submit a task, and watch it either auto-complete or land in the approval queue.

Try both paths:

- **High confidence** (auto-executes): `Summarize this paragraph in one sentence: ...`
- **Low confidence** (pauses for approval): `Delete all inactive user accounts older than 2 years` or `Send a refund to this customer`

## Deploy to Vercel (free)

SQLite's file lives on ephemeral disk in serverless functions and will **not** persist between invocations on Vercel. Switch to a free Postgres database before deploying:

1. Create a free Postgres database at [neon.tech](https://neon.tech) or [supabase.com](https://supabase.com) and copy the connection string.
2. In `prisma/schema.prisma`, change:

   ```prisma
   datasource db {
     provider = "postgresql"   // was "sqlite"
     url      = env("DATABASE_URL")
   }
   ```

3. Push to GitHub and import the repo on [vercel.com](https://vercel.com).
4. In Vercel's project settings, add these environment variables:
   - `DATABASE_URL`: your Postgres connection string
   - `GROQ_API_KEY`: your free Groq key
   - `GROQ_MODEL`: for example `llama-3.3-70b-versatile`
5. Deploy. Vercel runs `prisma generate` automatically through the `postinstall` script. Run `npx prisma db push` once locally against the production `DATABASE_URL` to create the tables.

No paid API key is required anywhere in this stack.

## Roadmap

- [ ] Per-category approval thresholds
- [ ] Independent risk classifier that overrides model confidence
- [ ] Role-based approval (not just "any human")
- [ ] Timeout and escalation when nobody approves
- [ ] Automated tests for the approval gate

## License

MIT
