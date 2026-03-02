# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (hot reload via tsx watch)
npm run dev

# Build TypeScript to dist/
npm run build

# Run compiled output
npm start

# Lint
npm run lint

# Format
npm run format
```

There are no tests configured. The package is published to GitHub Packages as `@boon-digital/rocket-admin-server`.

## Architecture

This is a **library package** — it exports a `start()` function that consuming apps call at startup. It is not a standalone server. The package is used as a submodule/dependency by apps like "miceflow".

### How consuming apps use this package

```ts
import { start, registerConfig, initEntityHooks } from '@boon-digital/rocket-admin-server';

await start(registry); // registry: Record<string, EntityRegistryEntry>
```

### Entity Registry pattern (central concept)

The registry (`EntityRegistryEntry[]`) drives everything: routes, MongoDB collections, search fields, and hook targets. It is passed in by the consuming app via `start(registry)`, which calls `registerConfig()` internally. All dynamic route/controller/service wiring happens after the registry is set.

`src/routes/index.ts` iterates the registry and calls `makeEntityController(key)` for each enabled entry, wiring standard CRUD + search routes automatically. Each entity key maps directly to a MongoDB collection name.

### Request lifecycle for entity writes

1. `POST/PATCH /:entity` hits the generic `entityController`
2. **Denormalization hook** (`DenormalizeFn`) runs — mutates the request body in place (e.g., resolving guest names from IDs, computing status fields)
3. `MongoService.create/update` persists to MongoDB
4. **Cross-entity sync hook** (`CrossEntitySyncFn`) runs — keeps related entities consistent (e.g., syncing stay summaries back to booking)

### Hook registration

Hooks are optional and app-specific. The consuming app's `src/config/entityHooks.ts` calls `registerDenormalization(key, fn)` and `registerCrossEntitySync(key, fn)` at startup via `initEntityHooks()`. The server ships with no hooks registered by default.

Current hooks (miceflow-specific):
- **bookings denorm**: computes `travelPeriodStart/End` from stay summaries; computes booking `status/subStatus`
- **stays denorm**: resolves `guestNames` from `guestIds` via contacts collection; computes stay `status/subStatus`
- **bookings cross-sync**: cascade-deletes all linked stays when a booking is deleted
- **stays cross-sync**: updates parent booking's `staySummaries` + recomputes booking status on every stay write

### Encryption (`src/lib/crypto.ts`)

AES-256-GCM encryption for credential fields. Encrypted values are prefixed `enc:v1:`. `maskEncryptedFields()` replaces encrypted values with `[encrypted]` before returning documents to clients. `getRawById()` on `MongoService` bypasses masking (used only in the decrypt controller). `ENCRYPTION_KEY` env var must be a 64-character hex string.

### Auth

Controlled by `AUTH_ENABLED=true` env var. When enabled: Google + Microsoft OAuth via Passport.js, MongoDB-backed sessions, `requireAuth` middleware on all API routes. When disabled (default for dev), all routes are open. Allowed email domains restricted via `ALLOWED_EMAIL_DOMAINS` env var (comma-separated).

### File uploads

`POST/DELETE /api/v1/upload` — dual-mode: writes to local `uploads/` directory when `BLOB_READ_WRITE_TOKEN` is absent or placeholder; proxies to Vercel Blob in production. Local uploads are served statically at `/uploads/*`.

### Cron job

`initStayStatusCron()` schedules a nightly midnight UTC job that recomputes `status/subStatus` for all non-cancelled stays and all bookings. Enabled only when `STAY_STATUS_CRON_ENABLED=true`.

## Key env vars

| Variable | Purpose |
|---|---|
| `MONGOCONNECTIONSTRING` | MongoDB connection URI |
| `MONGOCOLLECTION` | Database name |
| `PORT` | Server port (default 3001) |
| `API_PREFIX` | Route prefix (default `/api/v1`) |
| `CORS_ORIGIN` | Allowed CORS origin (default `http://localhost:3000`) |
| `AUTH_ENABLED` | Enable OAuth auth (`true`/`false`) |
| `SESSION_SECRET` | Express session secret |
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token (omit for local disk mode) |
| `STAY_STATUS_CRON_ENABLED` | Enable nightly status cron (`true`/`false`) |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated allowed OAuth email domains |

## Adding a new entity

1. Add an entry to the registry object passed to `start()` in the consuming app
2. Optionally register denormalization/sync hooks in `initEntityHooks()` using `registerDenormalization` / `registerCrossEntitySync`
3. The standard CRUD routes (`GET /`, `GET /search`, `GET /by-ids`, `GET /by-field/:field/:value`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`) are wired automatically

## Module format

ESM (`"type": "module"`). All internal imports use `.js` extensions (TypeScript ESM convention). `tsx` is used for development, `tsc` for production builds. `moduleResolution: bundler` in tsconfig.
