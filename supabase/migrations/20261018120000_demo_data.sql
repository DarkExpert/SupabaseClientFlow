begin;

create table if not exists public.clientflow_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  handoff_requested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clientflow_conversations_user_latest on public.clientflow_conversations(user_id, updated_at desc);

create table if not exists public.clientflow_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.clientflow_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 2000),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, request_id, role)
);
create index if not exists clientflow_messages_recent on public.clientflow_messages(conversation_id, created_at desc);

create table if not exists public.clientflow_ai_quota (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  primary key (user_id, day)
);

create table if not exists public.clientflow_slots (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null unique,
  duration_minutes integer not null default 30 check (duration_minutes = 30)
);
create table if not exists public.clientflow_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.clientflow_slots(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists clientflow_bookings_user on public.clientflow_bookings(user_id);

alter table public.clientflow_conversations enable row level security;
alter table public.clientflow_messages enable row level security;
alter table public.clientflow_ai_quota enable row level security;
alter table public.clientflow_slots enable row level security;
alter table public.clientflow_bookings enable row level security;
revoke all on public.clientflow_conversations, public.clientflow_messages, public.clientflow_ai_quota, public.clientflow_slots, public.clientflow_bookings from anon, authenticated;
grant all on public.clientflow_conversations, public.clientflow_messages, public.clientflow_ai_quota, public.clientflow_slots, public.clientflow_bookings to service_role;
grant select on public.clientflow_faq to service_role;
grant select on public.clientflow_conversations, public.clientflow_messages, public.clientflow_slots, public.clientflow_bookings to authenticated;
grant update (handoff_requested) on public.clientflow_conversations to authenticated;

create policy "Own conversations" on public.clientflow_conversations for select to authenticated using (user_id = (select auth.uid()));
create policy "Request own handoff" on public.clientflow_conversations for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own messages" on public.clientflow_messages for select to authenticated using (exists (select 1 from public.clientflow_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));
create policy "View slots" on public.clientflow_slots for select to authenticated using (starts_at > now());
create policy "Own bookings" on public.clientflow_bookings for select to authenticated using (user_id = (select auth.uid()));

create or replace view public.clientflow_available_slots as
  select s.id as slot_id from public.clientflow_slots s
  where s.starts_at > now() and not exists (
    select 1 from public.clientflow_bookings b where b.slot_id = s.id
  );
revoke all on public.clientflow_available_slots from public, anon;
grant select on public.clientflow_available_slots to authenticated;

create or replace function public.clientflow_book_slot(p_slot_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_booking uuid;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.clientflow_slots where id = p_slot_id and starts_at > now() for update) then
    raise exception 'Slot unavailable' using errcode = 'P0001';
  end if;
  insert into public.clientflow_bookings(slot_id, user_id) values (p_slot_id, v_user) returning id into v_booking;
  return v_booking;
exception when unique_violation then
  raise exception 'Slot already booked' using errcode = 'P0001';
end $$;
revoke all on function public.clientflow_book_slot(uuid) from public, anon;
grant execute on function public.clientflow_book_slot(uuid) to authenticated;

create or replace function public.clientflow_start_turn(p_user_id uuid, p_conversation_id uuid, p_request_id uuid, p_content text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_content is null or length(trim(p_content)) not between 1 and 2000 then raise exception 'Invalid message'; end if;
  perform 1 from public.clientflow_conversations where id = p_conversation_id and user_id = p_user_id for update;
  if not found then raise exception 'Conversation unavailable' using errcode = 'P0001'; end if;
  if exists (select 1 from public.clientflow_messages where conversation_id = p_conversation_id and request_id = p_request_id) then return false; end if;
  insert into public.clientflow_ai_quota(user_id, day, requests) values (p_user_id, (now() at time zone 'utc')::date, 0) on conflict do nothing;
  update public.clientflow_ai_quota set requests = requests + 1
    where user_id = p_user_id and day = (now() at time zone 'utc')::date and requests < 20
    returning requests into v_count;
  if v_count is null then raise exception 'Daily AI limit reached' using errcode = 'P0001'; end if;
  insert into public.clientflow_messages(conversation_id, role, content, request_id) values (p_conversation_id, 'user', trim(p_content), p_request_id);
  update public.clientflow_conversations set updated_at = now() where id = p_conversation_id;
  return true;
end $$;
revoke all on function public.clientflow_start_turn(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.clientflow_start_turn(uuid, uuid, uuid, text) to service_role;

create or replace function public.clientflow_finish_turn(p_user_id uuid, p_conversation_id uuid, p_request_id uuid, p_content text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_content is null or length(trim(p_content)) not between 1 and 2000 then raise exception 'Invalid reply'; end if;
  if not exists (select 1 from public.clientflow_conversations where id = p_conversation_id and user_id = p_user_id) then raise exception 'Conversation unavailable'; end if;
  if not exists (select 1 from public.clientflow_messages where conversation_id = p_conversation_id and request_id = p_request_id and role = 'user') then raise exception 'Missing user message'; end if;
  insert into public.clientflow_messages(conversation_id, role, content, request_id) values (p_conversation_id, 'assistant', trim(p_content), p_request_id)
    on conflict (conversation_id, request_id, role) do nothing;
  update public.clientflow_conversations set updated_at = now() where id = p_conversation_id;
end $$;
revoke all on function public.clientflow_finish_turn(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.clientflow_finish_turn(uuid, uuid, uuid, text) to service_role;

insert into public.clientflow_slots(starts_at) values
  ('2026-11-03 09:00:00+02'), ('2026-11-03 11:00:00+02'),
  ('2026-11-04 10:00:00+02'), ('2026-11-05 14:00:00+02')
on conflict (starts_at) do nothing;
commit;
