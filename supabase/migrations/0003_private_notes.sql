-- A private, user-scoped notebook for explicitly requested assistant memories.
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 600),
  created_at timestamptz not null default now()
);
create index if not exists notes_user_created_idx
  on public.notes(user_id, created_at desc);

alter table public.notes enable row level security;
create policy "own notes select" on public.notes for select
  to authenticated using (auth.uid() = user_id);
create policy "own notes insert" on public.notes for insert
  to authenticated with check (auth.uid() = user_id);
create policy "own notes delete" on public.notes for delete
  to authenticated using (auth.uid() = user_id);
