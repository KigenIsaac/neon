-- Enforce that a scene can only refer to a turn in its own conversation.
-- Basic foreign keys on turn_id alone cannot enforce this relationship.
create or replace function public.validate_scene_turn()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.turn_id is not null and not exists (
    select 1 from public.turns t
    where t.id = new.turn_id and t.conversation_id = new.conversation_id
  ) then
    raise exception 'Scene turn does not belong to this conversation'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists scenes_validate_turn on public.scenes;
create trigger scenes_validate_turn
  before insert or update of turn_id, conversation_id
  on public.scenes
  for each row execute function public.validate_scene_turn();
