begin;

create table public.clientflow_faq (
  id uuid primary key default gen_random_uuid(),
  question text not null unique,
  answer text not null,
  created_at timestamptz not null default now()
);

alter table public.clientflow_faq
  enable row level security;

revoke all on table public.clientflow_faq
  from anon, authenticated;

grant select on table public.clientflow_faq
  to anon, authenticated;

create policy "Demo FAQ is readable"
  on public.clientflow_faq
  for select
  to anon, authenticated
  using (true);

insert into public.clientflow_faq (question, answer)
values
  (
    'What are your opening hours?',
    'Our demo business is open Monday to Friday, 09:00–17:00 Europe/Helsinki.'
  ),
  (
    'What services do you offer?',
    'We offer a 30-minute introductory consultation.'
  ),
  (
    'How can I book an appointment?',
    'Choose an available appointment slot in the booking section.'
  );

commit;