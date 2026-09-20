-- Keep category for existing clients; separate event form from subject interests.
alter table public.events add column if not exists format text not null default '기타';
alter table public.events add column if not exists domains text[] not null default '{}';
alter table public.events add column if not exists participation_fee text;
