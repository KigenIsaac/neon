-- Global and per-account issuance caps. Run this migration BEFORE deploying the new token route.
-- These caps limit token *issuance*, not billed duration. Set spending alerts and
-- ceilings in your Deepgram account as well.
create table if not exists public.voice_token_quotas (
  scope text not null check (scope in ('user','global')),
  quota_key text not null,
  window_start timestamptz not null,
  uses integer not null default 0 check (uses >= 0),
  primary key (scope, quota_key, window_start)
);
alter table public.voice_token_quotas enable row level security;
revoke all on public.voice_token_quotas from public, anon, authenticated;

-- Run atomically to avoid serverless in-memory limiter bypasses.
create or replace function public.claim_voice_token_budget()
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  window_at timestamptz := date_trunc('hour', now());
  claimed integer;
begin
  if caller is null then return false; end if;

  -- A global ceiling survives anonymous-account rotation.
  insert into public.voice_token_quotas(scope, quota_key, window_start, uses)
  values ('global', 'all', window_at, 1)
  on conflict (scope, quota_key, window_start)
  do update set uses = public.voice_token_quotas.uses + 1
    where public.voice_token_quotas.uses < 240
  returning uses into claimed;
  if claimed is null then return false; end if;

  claimed := null;
  insert into public.voice_token_quotas(scope, quota_key, window_start, uses)
  values ('user', caller::text, window_at, 1)
  on conflict (scope, quota_key, window_start)
  do update set uses = public.voice_token_quotas.uses + 1
    where public.voice_token_quotas.uses < 12
  returning uses into claimed;

  -- In the rejected-user case the global slot is spent: conservative
  -- (fail-closed) behavior, so rejected attempts cannot increase usage.
  return claimed is not null;
end;
$$;
revoke all on function public.claim_voice_token_budget() from public;
grant execute on function public.claim_voice_token_budget() to authenticated;
