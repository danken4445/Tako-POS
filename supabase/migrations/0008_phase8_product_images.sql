-- TakoPOS Phase 8
-- Add image storage path for product media.

alter table if exists public.products
  add column if not exists image_path text;
