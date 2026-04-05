create table if not exists public.user_saves (
  user_id uuid not null references auth.users (id) on delete cascade,
  slot_id text not null default 'primary',
  version integer not null default 1,
  saved_at timestamptz not null default timezone('utc', now()),
  save_data jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, slot_id)
);

alter table public.user_saves enable row level security;

create or replace function public.set_user_saves_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_user_saves_updated_at on public.user_saves;
create trigger trg_user_saves_updated_at
before update on public.user_saves
for each row
execute function public.set_user_saves_updated_at();

drop policy if exists "user_saves_select_own" on public.user_saves;
create policy "user_saves_select_own"
on public.user_saves
for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "user_saves_insert_own" on public.user_saves;
create policy "user_saves_insert_own"
on public.user_saves
for insert
to authenticated
with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "user_saves_update_own" on public.user_saves;
create policy "user_saves_update_own"
on public.user_saves
for update
to authenticated
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "user_saves_delete_own" on public.user_saves;
create policy "user_saves_delete_own"
on public.user_saves
for delete
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

