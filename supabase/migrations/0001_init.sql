create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.scenes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  turn_id uuid references public.turns(id) on delete set null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists turns_conversation_idx on public.turns(conversation_id, created_at);
create index if not exists scenes_conversation_idx on public.scenes(conversation_id, created_at);

alter table public.profiles      enable row level security;
alter table public.conversations enable row level security;
alter table public.turns         enable row level security;
alter table public.scenes        enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own conversations" on public.conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own turns" on public.turns
  for all using (
    exists (select 1 from public.conversations c
            where c.id = turns.conversation_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.conversations c
            where c.id = turns.conversation_id and c.user_id = auth.uid())
  );

create policy "own scenes" on public.scenes
  for all using (
    exists (select 1 from public.conversations c
            where c.id = scenes.conversation_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.conversations c
            where c.id = scenes.conversation_id and c.user_id = auth.uid())
  );

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', 'Wanderer'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();