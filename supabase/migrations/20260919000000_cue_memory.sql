-- Cue user data schema. Apply with Supabase migrations after creating a project.
create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  onboarding_completed boolean not null default false,
  personalization_enabled boolean not null default true,
  recommendation_enabled boolean not null default true,
  locale text not null default 'ko-KR',
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  description text not null default '',
  category text not null,
  tags text[] not null default '{}',
  start_at timestamptz not null,
  end_at timestamptz not null,
  application_deadline timestamptz,
  location_name text not null,
  location_address text,
  source_url text,
  source_type text not null check (source_type in ('scan','recommendation','catalog','import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  check ((source_type = 'catalog' and owner_user_id is null) or (source_type <> 'catalog' and owner_user_id is not null))
);
create index events_owner_idx on public.events(owner_user_id);
create index events_start_idx on public.events(start_at);

create table public.event_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  label text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  location_name text not null,
  location_address text,
  check (end_at > start_at)
);
create index event_sessions_event_idx on public.event_sessions(event_id);

create table public.user_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  status text not null check (status in ('discovered','viewed','interested','saved','planned','completed','dismissed','unsaved')),
  origin text not null check (origin in ('scan','recommendation')),
  calendar_id text,
  calendar_event_id text,
  reminder_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,event_id)
);
create index user_events_event_idx on public.user_events(event_id);

create table public.event_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  action text not null check (action in ('viewed','interested','not_interested','saved','unsaved','plan_created','calendar_added','recommendation_opened','recommendation_dismissed','completed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index event_interactions_user_time_idx on public.event_interactions(user_id,created_at desc);
create index event_interactions_event_idx on public.event_interactions(event_id);

create table public.interest_profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  interest_key text not null,
  score double precision not null,
  confidence double precision not null check (confidence between 0 and 1),
  evidence_count integer not null check (evidence_count >= 0),
  last_updated_at timestamptz not null default now(),
  primary key (user_id,interest_key)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  related_event_id uuid references public.events(id) on delete set null,
  title text not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  created_at timestamptz not null default now(),
  target_at timestamptz,
  completed_at timestamptz
);
create index goals_user_idx on public.goals(user_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  depends_on_task_id uuid references public.tasks(id) on delete set null,
  title text not null,
  status text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled')),
  created_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz
);
create index tasks_user_idx on public.tasks(user_id);
create index tasks_goal_idx on public.tasks(goal_id);

create table public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_type text not null,
  interest_key text not null,
  content text not null,
  confidence double precision not null check (confidence between 0 and 1),
  evidence_count integer not null check (evidence_count >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (user_id,memory_type,interest_key)
);
create index agent_memories_user_idx on public.agent_memories(user_id);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  recommendation_score double precision not null,
  reason text not null,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  dismissed_at timestamptz,
  accepted_at timestamptz,
  unique (user_id,event_id)
);
create index recommendations_user_idx on public.recommendations(user_id,created_at desc);

create or replace function public.cue_create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id) values(new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger cue_auth_user_created after insert on auth.users
for each row execute function public.cue_create_profile();

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_sessions enable row level security;
alter table public.user_events enable row level security;
alter table public.event_interactions enable row level security;
alter table public.interest_profiles enable row level security;
alter table public.goals enable row level security;
alter table public.tasks enable row level security;
alter table public.agent_memories enable row level security;
alter table public.recommendations enable row level security;

revoke all on public.profiles, public.events, public.event_sessions, public.user_events,
  public.event_interactions, public.interest_profiles, public.goals, public.tasks,
  public.agent_memories, public.recommendations from anon, authenticated;
grant all on public.profiles, public.events, public.event_sessions, public.user_events,
  public.event_interactions, public.interest_profiles, public.goals, public.tasks,
  public.agent_memories, public.recommendations to service_role;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.events, public.event_sessions,
  public.user_events, public.goals, public.tasks to authenticated;
grant select, insert on public.event_interactions to authenticated;
grant select on public.interest_profiles, public.agent_memories, public.recommendations to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy profiles_update on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy events_select on public.events for select to authenticated
  using (owner_user_id is null or (select auth.uid()) = owner_user_id);
create policy events_insert on public.events for insert to authenticated
  with check ((select auth.uid()) = owner_user_id and source_type in ('scan','recommendation','import'));
create policy events_update on public.events for update to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id and source_type <> 'catalog');
create policy events_delete on public.events for delete to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy event_sessions_select on public.event_sessions for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and
    (e.owner_user_id is null or e.owner_user_id = (select auth.uid()))));
create policy event_sessions_insert on public.event_sessions for insert to authenticated
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_user_id = (select auth.uid())));
create policy event_sessions_update on public.event_sessions for update to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_user_id = (select auth.uid())))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner_user_id = (select auth.uid())));
create policy event_sessions_delete on public.event_sessions for delete to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and e.owner_user_id = (select auth.uid())));

create policy user_events_select on public.user_events for select to authenticated
  using ((select auth.uid()) = user_id);
create policy user_events_insert on public.user_events for insert to authenticated
  with check ((select auth.uid()) = user_id and exists
    (select 1 from public.events e where e.id = event_id and (e.owner_user_id is null or e.owner_user_id = user_id)));
create policy user_events_update on public.user_events for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists
    (select 1 from public.events e where e.id = event_id and (e.owner_user_id is null or e.owner_user_id = user_id)));
create policy user_events_delete on public.user_events for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy interactions_select on public.event_interactions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy interactions_insert on public.event_interactions for insert to authenticated
  with check ((select auth.uid()) = user_id and exists
    (select 1 from public.events e where e.id = event_id and (e.owner_user_id is null or e.owner_user_id = user_id)));

create policy interests_select on public.interest_profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy memories_select on public.agent_memories for select to authenticated
  using ((select auth.uid()) = user_id);
create policy recommendations_select on public.recommendations for select to authenticated
  using ((select auth.uid()) = user_id);

create policy goals_select on public.goals for select to authenticated
  using ((select auth.uid()) = user_id);
create policy goals_insert on public.goals for insert to authenticated
  with check ((select auth.uid()) = user_id and (related_event_id is null or exists
    (select 1 from public.events e where e.id = related_event_id and (e.owner_user_id is null or e.owner_user_id = user_id))));
create policy goals_update on public.goals for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy goals_delete on public.goals for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy tasks_select on public.tasks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy tasks_insert on public.tasks for insert to authenticated
  with check ((select auth.uid()) = user_id and exists
    (select 1 from public.goals g where g.id = goal_id and g.user_id = public.tasks.user_id));
create policy tasks_update on public.tasks for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists
    (select 1 from public.goals g where g.id = goal_id and g.user_id = public.tasks.user_id));
create policy tasks_delete on public.tasks for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.cue_check_task_dependency()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.depends_on_task_id is not null and not exists (
    select 1 from public.tasks parent where parent.id = new.depends_on_task_id
      and parent.user_id = new.user_id and parent.goal_id = new.goal_id
  ) then
    raise exception 'Task dependency must belong to the same user and goal';
  end if;
  return new;
end;
$$;
create trigger cue_task_dependency before insert or update on public.tasks
for each row execute function public.cue_check_task_dependency();
