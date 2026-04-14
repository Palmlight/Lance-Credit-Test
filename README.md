# Lance Credit Test

This repository contains a wallet service built with:

- Backend: Node.js, TypeScript, Express, PostgreSQL, Drizzle ORM
- Frontend: React.js with Vite

The system uses a ledger-first design. Wallet balances are never stored as the source of truth; instead, the current balance is derived from immutable ledger entries.

## Architecture

### Backend

The backend exposes these main endpoints:

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /wallet/deposit`
- `POST /wallet/transfer`
- `GET /wallet/me/transactions`
- `GET /wallet/me/balance`

For compatibility with the original “create user” requirement, `POST /users` is wired to the same registration flow as `POST /auth/register`.

The backend uses `Drizzle ORM` instead of Prisma, Objection, or Knex. I chose Drizzle because it gives us:

- strongly typed models in TypeScript
- a schema defined in code inside `src/models`
- PostgreSQL-friendly control for transactions, row locks, checks, and custom ledger queries
- versioned SQL migrations that can be committed to the repository
- a lighter runtime than Prisma, while staying closer to the database for finance-heavy logic

Core models:

- `users`: account holder records and credentials
- `wallets`: one wallet per user
- `ledger_transactions`: business-level transaction records such as deposits and transfers
- `ledger_entries`: debit and credit entries that form the ledger
- `idempotency_keys`: deduplicates repeated POST requests

### Frontend

The frontend is a simple React/Vite UI that lets a user:

- register an account and wallet
- log in with email and password
- deposit funds into their own wallet
- transfer funds from their own wallet to another user
- inspect their balance
- inspect their transaction history

## Key Design Decisions

### 1. Ledger entries are the source of truth

Balances are derived by summing ledger entries:

- credits add value
- debits subtract value

This avoids drift between a stored balance and the underlying transaction record.

### 2. Transfers are atomic

Each financial write runs inside a single PostgreSQL transaction with `SERIALIZABLE` isolation.

For transfers:

- both wallet rows are locked with `FOR UPDATE`
- the sender balance is recomputed inside the transaction
- debit and credit entries are inserted together
- if any step fails, the whole transaction rolls back

This prevents partial updates and keeps the ledger balanced.

### 3. Concurrency safety

To prevent race conditions and double spending when multiple transfers hit the same wallet:

- wallet rows are locked before checking balance
- concurrent transfers from the same wallet serialize on the lock
- balance checks happen only after the lock is held
- PostgreSQL serializable isolation adds an additional correctness guard

### 4. JWT-based authentication and authorization

The application now uses JWT access tokens instead of a shared API key.

This gives the system:

- per-user identity
- scoped access to a user’s own wallet
- a more realistic frontend-to-backend auth model
- a better foundation for roles, refresh tokens, and stronger session controls later

Transfers no longer trust a client-supplied `from_user_id`. The sender is derived from the authenticated JWT subject.

### 5. Basic security

This take-home includes simple but useful protections:

- JWT authentication with bearer tokens
- password hashing with `bcryptjs`
- request validation with `zod`
- idempotency keys to reduce duplicate financial writes
- `helmet` and `cors` configuration

## Why Drizzle Over Prisma

Prisma is a very good choice for CRUD-heavy applications, but for this wallet service I preferred Drizzle because:

- this project needs SQL-first control for ledger queries, row locking, and serializable transactions
- Drizzle stays closer to PostgreSQL, which is helpful in financial systems where database behavior matters a lot
- the schema is plain TypeScript and easy to keep alongside the service layer
- generated SQL migrations are simple to inspect and review
- there is less tooling overhead than Prisma Client generation

If this were a more CRUD-centric product with less custom SQL and less database-level concurrency work, Prisma would also be a strong option.

## Assumptions

- Amounts are integer minor units, for example `5000` means 5,000 cents or the smallest currency unit.
- One wallet exists per user.
- Deposits are treated as trusted internal credits rather than external payment-processor events.
- This project uses access tokens only. A production system would typically add refresh tokens, revocation, and stronger key management.

## Project Structure

- [backend](/Users/ndonnauc/Documents/Lance%20Credit%20Test/backend)
- [backend/src/models](/Users/ndonnauc/Documents/Lance%20Credit%20Test/backend/src/models)
- [backend/drizzle.config.ts](/Users/ndonnauc/Documents/Lance%20Credit%20Test/backend/drizzle.config.ts)
- [backend/drizzle](/Users/ndonnauc/Documents/Lance%20Credit%20Test/backend/drizzle)
- [frontend](/Users/ndonnauc/Documents/Lance%20Credit%20Test/frontend)

## Run Locally

### 1. Create environment files

Backend:

```bash
cp backend/.env.example backend/.env
```

Frontend:

```bash
cp frontend/.env.example frontend/.env
```

### 2. Configure PostgreSQL

Set `DATABASE_URL` in `backend/.env` to your provider connection string. Example format:

```env
DATABASE_URL=postgresql://USERNAME:PASSWORD@YOUR-HOST.us-east-1.aws.neon.tech/lance_credit_test?sslmode=require
DATABASE_SSL=true
JWT_SECRET=replace-this-with-a-long-random-secret
JWT_EXPIRES_IN=1d
```

If you want to use a local PostgreSQL database instead, you can still do that:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wallet_service
DATABASE_SSL=false
```

### 3. Install dependencies

From the repository root:

```bash
npm install
```

### 4. Migration workflow

Generate a new migration after changing the models:

```bash
npm run db:generate --workspace backend
```

Apply committed migrations to the database:

```bash
npm run db:migrate --workspace backend
```

For quick local prototyping only, you can still push schema changes directly without creating a migration:

```bash
npm run db:push --workspace backend
```

Recommended usage:

- use `db:generate` when the schema changes
- commit the files inside `backend/drizzle`
- use `db:migrate` in shared or production-like environments
- reserve `db:push` for throwaway local development

Note: if you already applied the earlier pre-JWT schema in a local database, the new auth migration assumes the `users` table can accept required `email` and `password_hash` columns. On a fresh setup this is fine; on an older prototype database, reset the local DB or backfill those values before migrating.

### 5. Run the backend

```bash
npm run dev:backend
```

The API will start on `http://localhost:4000`.

### 6. Run the frontend

```bash
npm run dev:frontend
```

The UI will start on `http://localhost:5173`.

## API Notes

Protected endpoints require:

- `Authorization: Bearer <JWT_TOKEN>`

Financial `POST` requests should also send:

- `x-idempotency-key: <unique-client-generated-key>`

Example register request:

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: register-1" \
  -d '{"name":"John Doe","email":"john@example.com","password":"password123"}'
```

Example login request:

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"password123"}'
```

Example deposit request:

```bash
curl -X POST http://localhost:4000/wallet/deposit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "x-idempotency-key: deposit-1" \
  -d '{"amount":5000}'
```

Example transfer request:

```bash
curl -X POST http://localhost:4000/wallet/transfer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "x-idempotency-key: transfer-1" \
  -d '{"to_user_id":"<RECIPIENT_USER_ID>","amount":1000}'
```

Example balance request:

```bash
curl http://localhost:4000/wallet/me/balance \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

## Scaling to 10 Million Transactions Per Day

If this system needed to process 10 million transactions per day, I would scale it in several layers:

- Split reads from writes using primary-replica PostgreSQL and move history/balance read traffic onto replicas where safe.
- Partition ledger tables by time or wallet ranges to keep indexes smaller and improve write/read performance.
- Introduce queue-backed ingestion for non-interactive workloads such as external deposits, reconciliations, notifications, and exports.
- Maintain derived balance projections or materialized views for read performance, while keeping the ledger as the source of truth.
- Add stronger operational tooling: metrics for transfer latency, lock waits, idempotency conflicts, failed transactions, and reconciliation mismatches.
- Use distributed tracing, structured logs, dashboards, and alerting around transaction failures and database saturation.
- Add rate limiting, per-tenant isolation strategies, and possibly shard wallets across databases once a single primary becomes the bottleneck.

## What To Improve Next

Given more time, I would add:

- automated tests for concurrent transfer scenarios
- refresh tokens and token revocation support
- reconciliation jobs and operational admin endpoints
- pagination and filtering for transaction history
- online schema rollout checks for zero-downtime deploys
