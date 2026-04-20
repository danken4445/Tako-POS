# TakoPOS

Offline-first, multi-tenant POS starter for food carts, built with Expo + Supabase.

## Phase 1 Included

- Supabase Auth integration with secure local session persistence.
- Multi-tenant row-level security model using `tenant_id` isolation.
- RBAC roles: `SuperAdmin`, `StoreOwner`, `Cashier`.
- Orientation-aware shell:
  - `Cashier` -> landscape POS UI.
  - `StoreOwner` and `SuperAdmin` -> portrait Admin dashboard UI.
- Dynamic tenant branding using `tenant_preferences.color_palette` and logo from Supabase Storage.
- Offline queue foundation using Expo SQLite (`pending_mutations` table).

## Phase 2 Included

- Local-first storage for core POS data in SQLite:
   - `local_products`
   - `local_inventory_items`
   - `local_sales`
   - `local_sale_items`
- Background sync engine:
   - Pushes queued local mutations (`pending_mutations`) to Supabase.
   - Pulls remote product/inventory changes into local cache.
   - Uses a simple last-write-wins cursor strategy per tenant.
- Single-device tenant model support:
   - No multi-device conflict branch logic.
   - Mutations are retried with backoff on transient network failure.

## Sync Model

- All POS reads/writes use local SQLite first.
- Writes are enqueued and acknowledged immediately for offline use.
- When online, sync runs periodically and on-demand:
   - Push local pending writes.
   - Pull backend updates such as price/inventory changes.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure environment variables:
   - Copy `.env.example` to `.env`.
   - Fill in:
     - `EXPO_PUBLIC_SUPABASE_URL`
     - `EXPO_PUBLIC_SUPABASE_ANON_KEY`

3. Run app:

   ```bash
   npm run start
   ```

4. Type-check:

   ```bash
   npm run typecheck
   ```

## Supabase Setup

1. Open Supabase SQL editor.
2. Run `supabase/migrations/0001_phase1_auth_rbac_multitenancy.sql`.
3. Create users in Supabase Auth.
4. Create one `tenants` row per business.
5. Insert `user_profiles` rows mapping each auth user to a `tenant_id` and `role`.
6. Optional branding:
   - Insert `tenant_preferences` with `color_palette` JSON.
   - Upload tenant logo to storage bucket `tenant-assets` with key format:
     - `<tenant_uuid>/logo.png`

## Notes

- Storage policy expects object path first segment to be the tenant UUID.
- The app signs logo URLs at runtime using `createSignedUrl`.
- RLS policies prevent cross-tenant access on core tables.
