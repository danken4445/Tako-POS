# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TakoPOS is an offline-first, multi-tenant POS (Point of Sale) app for food carts, built with Expo (React Native) and Supabase. All reads/writes go through local SQLite first, then sync to Supabase in the background.

## Commands

```bash
npm install          # Install dependencies
npm run start        # Start Expo dev server
npm run android      # Start on Android
npm run ios          # Start on iOS
npm run web          # Start on web
npm run typecheck    # TypeScript type-check (tsc --noEmit)
```

There are no test runners, linters, or formatters configured.

## Environment Setup

Copy `.env.example` to `.env` and set:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

The app gracefully degrades when env vars are missing (shows a config screen). Supabase migrations live in `supabase/migrations/` and must be run manually in the Supabase SQL editor in order.

## Architecture

### Auth & Multi-Tenancy

- Supabase Auth with session stored in `expo-secure-store` (native) or `localStorage` (web).
- Three RBAC roles: `SuperAdmin`, `StoreOwner`, `Cashier`.
- Every data table is scoped by `tenant_id` with RLS policies on the Supabase side.
- `src/services/tenantService.ts` fetches `user_profiles` + `tenant_preferences` after login.

### Orientation-Aware Shell (`App.tsx`)

- `Cashier` role locks to landscape and renders `PosLandscapeScreen`.
- `StoreOwner`/`SuperAdmin` get portrait `AdminDashboardScreen`.
- Unauthenticated users see `AuthScreen`.

### State Management (Zustand)

- `src/store/authStore.ts` — session, profile, preferences; listens to `onAuthStateChange`.
- `src/store/themeStore.ts` — tenant color palette and logo URL, hydrated from `tenant_preferences`.

### Offline-First Data Layer

**Local DB** (`src/services/offlineDb.ts`):
- Uses `expo-sqlite` (database file: `takopos.db`).
- Tables: `local_products`, `local_categories`, `local_staff_members`, `local_inventory_items`, `local_sales`, `local_sale_items`, `local_shifts`, `local_shift_events`, `local_shift_reports`, `pending_mutations`, `sync_cursors`.
- Migrations are inline `ALTER TABLE ... ADD COLUMN` statements wrapped in `.catch(() => undefined)` for idempotency.
- All monetary values are stored in **cents** (integer). Prices use `selling_price_cents` and `cost_price_cents`.
- Products can link to multiple inventory items via `linked_inventory_item_ids_json` (JSON array of UUIDs) with a `deduction_multiplier`.
- Soft deletes use `deleted_at` column pattern.
- The `withOfflineDb` helper ensures the DB is initialized before running any query.

**Mutation Queue** (`pending_mutations` table):
- Every write upserts locally and enqueues a `pending_mutations` row.
- Mutations are JSON payloads with `operation` (always `'UPSERT'`), `table_name`, and `payload`.
- Retry with exponential backoff; irrecoverable errors (bad UUIDs) are silently discarded.

### Sync Engine (`src/services/syncService.ts`)

- Runs every 8 seconds via `setInterval` after login.
- **Push**: drains `pending_mutations` sorted by priority (inventory → categories/staff → products → sales/shift_reports).
- **Pull**: cursor-based incremental fetch from Supabase for products, inventory, categories, staff, sales.
- Uses `last-write-wins` strategy per tenant (single-device model, no conflict resolution).
- `product_inventory_links` is a separate Supabase table for many-to-many product↔inventory relationships; pulled and merged during sync.
- `triggerSyncNow()` can be called on-demand (e.g., after creating a sale).

### Services

- `posService.ts` — `getPosSnapshot()` aggregates local data; `createSaleLocalFirst()` writes locally then triggers sync.
- `adminService.ts` — CRUD for products, categories, staff, inventory; analytics queries (top sellers, period KPIs); image upload to Supabase Storage bucket `tenant-assets`.
- `shiftService.ts` — shift open/close, pay-in/pay-out events, shift report generation.
- `posHardware.ts` — stubs for cash drawer and receipt printer (placeholder implementations).

### Screens

- `src/screens/pos/PosLandscapeScreen.tsx` — full POS UI: product grid, cart, checkout with cash/card/QR, shift management overlay.
- `src/screens/admin/AdminDashboardScreen.tsx` — tabbed admin panel: overview analytics, transactions, shift reports, product/inventory/category/staff CRUD, branding settings.
- `src/screens/admin/components/SalesAnalyticsPanel.tsx` — reusable analytics display component.

### Supabase Storage

- Bucket: `tenant-assets`
- Path convention: `<tenant_uuid>/products/<product_id>-<timestamp>.<ext>` for product images.
- Logo path: `<tenant_uuid>/logo.png`
- URLs are signed at runtime via `createSignedUrl` (24h expiry).

## Key Patterns

- All IDs are UUIDs. Local IDs are generated with `crypto.randomUUID()` or a polyfill.
- The `enqueueMutation` + `upsertLocal*` pattern is the standard write path — always upsert locally first, then enqueue.
- Boolean fields are stored as `0`/`1` in SQLite and mapped back to JS booleans on read.
- The `initializeOfflineDb` function is idempotent and safe to call repeatedly.
- NativeWind (Tailwind for React Native) is a dependency but the screens currently use `StyleSheet.create` for styling.
