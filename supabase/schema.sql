-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.

-- 1. People ---------------------------------------------------------------
create table if not exists public.allowed_emails (
  email text primary key            -- lower-case; add teammates here before they sign up
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  is_owner boolean not null default false,
  approved boolean not null default false
);

-- First person to sign up becomes the owner. Everyone else is approved only if their
-- email is in allowed_emails.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, email, name, is_owner, approved)
  values (
    new.id, lower(new.email),
    coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)),
    first_user,
    first_user or exists (select 1 from public.allowed_emails a where a.email = lower(new.email))
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), false)
$$;

-- 2. Documents ------------------------------------------------------------
-- One table holds tasks, focus areas (shared) and goals, goal logs, personal tasks (private).
-- owner_scope = null  -> shared with every approved member
-- owner_scope = <uid> -> visible only to that person
create table if not exists public.docs (
  coll text not null,
  id text not null,
  owner_scope uuid references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (coll, id)
);
create index if not exists docs_owner_idx on public.docs (owner_scope);
alter table public.docs replica identity full;

alter table public.docs enable row level security;
drop policy if exists docs_read on public.docs;
drop policy if exists docs_write on public.docs;
create policy docs_read on public.docs for select to authenticated
  using (public.is_approved() and (owner_scope is null or owner_scope = auth.uid()));
create policy docs_write on public.docs for all to authenticated
  using (public.is_approved() and (owner_scope is null or owner_scope = auth.uid()))
  with check (public.is_approved() and (owner_scope is null or owner_scope = auth.uid()));

-- Merge a patch into a document (the planner's "update").
create or replace function public.docs_merge(p_coll text, p_id text, p_patch jsonb, p_scope uuid)
returns void language plpgsql security invoker as $$
begin
  insert into public.docs (coll, id, owner_scope, data) values (p_coll, p_id, p_scope, p_patch)
  on conflict (coll, id) do update set data = public.docs.data || excluded.data, updated_at = now();
end $$;

-- Names for the "who owns this task" labels.
alter table public.profiles enable row level security;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (public.is_approved() or id = auth.uid());
-- Profiles are read-only from the app; change names in the dashboard (Table Editor -> profiles).

alter table public.allowed_emails enable row level security;  -- no policies: edit it in the dashboard

-- 3. Live updates ----------------------------------------------------------
alter publication supabase_realtime add table public.docs;
