# Lance Credit Test


Frontend URL: https://lance-credit-test-frontend.vercel.app/

Backend URL: https://lance-credit-test.onrender.com

This repository contains a full-stack wallet service with a TypeScript/Express backend, a React/Vite frontend, and PostgreSQL for persistence.

The project supports:

- user registration and login with JWTs
- wallet deposits
- wallet-to-wallet transfers
- balance lookup
- transaction history lookup

## System Architecture

### High-level flow

1. The React frontend calls the Express API over HTTP.
2. The backend authenticates users with JWT bearer tokens.
3. Financial operations run inside PostgreSQL transactions through Drizzle ORM.
4. Each money movement creates immutable ledger records and updates wallet balance snapshots.

```text
Frontend (React + Vite)
        |
        v
Backend API (Express + TypeScript)
        |
        v
Service Layer (auth, user, wallet)
        |
        v
PostgreSQL + Drizzle ORM
        |
        +-- users
        +-- wallets
        +-- ledger_transactions
        +-- ledger_entries
```

### Backend

The backend is organized by module:

- `backend/src/modules/auth`: registration, login, and current-user lookup
- `backend/src/modules/user`: user creation compatibility route and user data access
- `backend/src/modules/wallet`: deposits, transfers, balances, and transaction history
- `backend/src/middleware`: auth, validation, and centralized error handling
- `backend/src/models`: Drizzle table definitions for the database schema
- `backend/src/db`: PostgreSQL pool setup and serializable transaction helper

Main API routes:

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /users`
- `POST /wallet/deposit`
- `POST /wallet/transfer`
- `GET /wallet/me/balance`
- `GET /wallet/me/transactions`
- `GET /wallet/:userId/balance`
- `GET /wallet/:userId/transactions`
- `GET /health`

### Data model

The core tables are:

- `users`: account identity and hashed credentials
- `wallets`: one wallet per user plus the current balance snapshot
- `ledger_transactions`: business-level deposit and transfer records
- `ledger_entries`: the debit and credit entries linked to each transaction

### Frontend

The frontend is a small single-page React app that:

- registers new users
- logs users in and stores the JWT in local storage
- calls authenticated wallet endpoints
- displays current balance and transaction history
- provides forms for deposit and transfer actions

## Key Design Decisions

### 1. Ledger records plus balance snapshots

The system stores immutable transaction and ledger-entry history, but it also keeps a `wallets.balance` snapshot for fast reads.

That gives us:

- an auditable record of every money movement
- a simple way to reconstruct what happened
- faster balance reads than recalculating from the ledger on every request

### 2. Financial writes are transactional

Deposits and transfers run inside PostgreSQL transactions with `SERIALIZABLE` isolation. The backend retries serialization failures up to three times.

For transfers specifically:

- both wallets are looked up inside the same transaction
- sender and recipient rows are locked with `FOR UPDATE`
- insufficient funds are checked after the lock is taken
- ledger records and balance updates are committed together or rolled back together

### 3. JWT-based authentication

The API uses JWT bearer tokens instead of a shared API key. That keeps wallet actions tied to the authenticated user and prevents the client from choosing an arbitrary sender wallet during transfers.

### 4. Schema-first persistence with Drizzle

I used Drizzle ORM because it fits a database-heavy service well:

- the schema lives in TypeScript
- PostgreSQL behavior stays visible and controllable
- SQL migrations are generated into versioned files under `backend/drizzle`
- the code stays close to the database for transaction and locking logic

### 5. Thin frontend, heavier backend rules

The frontend is intentionally simple. Validation, authentication, transaction handling, and business invariants are enforced in the backend, which is the right place for finance-related correctness.

## Assumptions

- Amounts are stored as integer minor units. For example, `5000` means 5,000 cents or the smallest currency unit.
- Each user has exactly one wallet.
- Deposits are trusted internal credits, not external payment-processor events.
- This project uses access tokens only; refresh tokens and token revocation are out of scope.
- The balance snapshot in `wallets` is treated as the fast-read representation, while the ledger tables remain the audit trail.
- The frontend is intended as a functional demo client, not a production-ready banking UI.

## How To Run Locally

### 1. Install dependencies

From the repository root:

```bash
npm install
```

### 2. Create environment files

Backend:

```bash
cp backend/.env.example backend/.env
```

Frontend:

```bash
cp frontend/.env.example frontend/.env
```

### 3. Start PostgreSQL

The easiest local option is Docker:

```bash
docker compose up -d
```

This starts PostgreSQL on `localhost:5432` with:

- database: `wallet_service`
- user: `postgres`
- password: `postgres`

If you prefer your own PostgreSQL instance, that works too.

### 4. Configure the backend env

For local Docker PostgreSQL, `backend/.env` can look like this:

```env
PORT=4000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wallet_service
DATABASE_SSL=false
JWT_SECRET=super-secret
JWT_EXPIRES_IN=1d
CORS_ORIGIN=http://localhost:5173
```

For the frontend, `frontend/.env` should contain:

```env
VITE_API_URL=http://localhost:4000
```

### 5. Apply database schema

Run the committed migrations:

```bash
npm run db:migrate --workspace backend
```

If you change the schema later, generate a new migration with:

```bash
npm run db:generate --workspace backend
```

### 6. Start the backend

```bash
npm run dev:backend
```

The API will be available at `http://localhost:4000`.

### 7. Start the frontend

In a second terminal:

```bash
npm run dev:frontend
```

The app will be available at `http://localhost:5173`.

## Useful Notes

- Protected wallet routes require `Authorization: Bearer <token>`.
- The frontend automatically stores the JWT after login/register.
- The backend exposes `GET /health` for a quick health check.
- The repository root is configured as an npm workspace for `backend` and `frontend`.

## How I Would Scale This To 10 Million Transactions Per Day

At that volume, I would keep the same core ledger and transactional model, but I would change the surrounding infrastructure so the database is reserved for the most critical synchronous work.

### Infrastructure

- Run the API as multiple stateless application instances behind a load balancer.
- Separate read and write traffic where possible, with a primary PostgreSQL node for writes and replicas for safe read-heavy endpoints.
- Use autoscaling based on request volume, latency, queue depth, and database saturation metrics.
- Put the system behind an API gateway or edge layer for rate limiting, auth enforcement, and traffic shaping.

### Database design

- Keep transfers and deposits strongly consistent on the write path using PostgreSQL transactions.
- Partition high-volume tables such as `ledger_transactions` and `ledger_entries`, most likely by time and possibly by wallet range once data grows large enough.
- Add carefully chosen covering indexes for the most common history and balance-access patterns.
- Continue storing a balance snapshot on the wallet for fast reads, while treating ledger records as the audit trail.
- Introduce archival and cold-storage strategies for older transaction history so hot tables remain smaller and faster.

### Queues and asynchronous processing

- Keep balance-changing writes synchronous, but move non-critical follow-up work to queues.
- Queue jobs for notifications, exports, reconciliation reports, analytics pipelines, fraud checks, and webhook delivery.
- Use an outbox-style pattern so events are recorded transactionally before being published to background workers.
- Add idempotent consumers and dead-letter queues so retries do not create duplicate side effects.

### Caching

- Cache non-critical read-heavy responses such as profile lookups, recent transaction pages, and metadata.
- Avoid using cache as the source of truth for balances during writes; balances should still come from the transactional store.
- Use short-lived cache entries or explicit invalidation after deposit and transfer operations for endpoints that can safely be cached.
- Consider Redis for token/session support, rate limiting, and lightweight read models.

### Monitoring and observability

- Add structured logs with request IDs, user IDs, transaction IDs, and idempotency keys for traceability.
- Track metrics for throughput, p95/p99 latency, serialization retries, lock waits, failed transfers, queue lag, and database connection pool health.
- Instrument distributed tracing across API requests, database calls, and async workers.
- Set alerts for balance mismatches, unusual failure spikes, replica lag, queue backlogs, and database resource saturation.
- Add reconciliation jobs and dashboards so the team can detect ledger inconsistencies or operational drift quickly.

In short, I would preserve strong consistency for money movement, but scale reads, background work, and operational visibility around that core so the system stays reliable under much higher throughput.


