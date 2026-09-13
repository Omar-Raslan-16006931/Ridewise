-- Ridewise: run this once in the Supabase SQL Editor.
-- It uses magic-link Auth and a shared group whose members can both edit trips.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 50),
  created_at timestamptz not null default now()
);

create table if not exists public.ride_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  created_at timestamptz not null default now()
);

create table if not exists public.ride_group_members (
  group_id uuid not null references public.ride_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 50),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.ride_trips (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.ride_groups(id) on delete cascade,
  ride_at timestamptz not null default now(),
  direction text not null check (direction in ('campus', 'home')),
  amount numeric(10,2) not null check (amount > 0 and amount < 100000),
  paid_by uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  notes text check (char_length(notes) <= 280),
  settled_at timestamptz,
  settled_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((settled_at is null and settled_by is null) or (settled_at is not null and settled_by is not null))
);

-- One immutable record for every reimbursement. A trip has one owed half,
-- so it can have at most one settlement record.
create table if not exists public.ride_settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.ride_groups(id) on delete cascade,
  trip_id uuid not null unique references public.ride_trips(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0 and amount < 100000),
  paid_by uuid not null references public.profiles(id),
  received_by uuid not null references public.profiles(id),
  settled_at timestamptz not null default now(),
  recorded_by uuid not null references public.profiles(id),
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now(),
  check (paid_by <> received_by)
);

create index if not exists ride_trips_group_ride_at_idx on public.ride_trips (group_id, ride_at desc);
create index if not exists ride_trips_group_payer_ride_at_idx on public.ride_trips (group_id, paid_by, ride_at desc);
create index if not exists ride_trips_open_balance_idx on public.ride_trips (group_id, paid_by, ride_at desc) where settled_at is null;
create index if not exists ride_settlements_group_settled_at_idx on public.ride_settlements (group_id, settled_at desc);
create index if not exists ride_settlements_group_payer_idx on public.ride_settlements (group_id, paid_by, settled_at desc);

create or replace function public.is_ride_group_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ride_group_members
    where group_id = target_group_id and user_id = (select auth.uid())
  );
$$;

create or replace function public.create_ride_group(group_name text, member_name text)
returns public.ride_groups
language plpgsql
security definer
set search_path = public
as $$
declare new_group public.ride_groups;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  insert into public.profiles (id, full_name) values ((select auth.uid()), member_name)
  on conflict (id) do update set full_name = excluded.full_name;
  insert into public.ride_groups (name) values (group_name) returning * into new_group;
  insert into public.ride_group_members (group_id, user_id, display_name)
  values (new_group.id, (select auth.uid()), member_name);
  return new_group;
end;
$$;

create or replace function public.join_ride_group(group_code text, member_name text)
returns public.ride_groups
language plpgsql
security definer
set search_path = public
as $$
declare target_group public.ride_groups;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  select * into target_group from public.ride_groups where invite_code = upper(trim(group_code));
  if target_group.id is null then raise exception 'That invite code was not found'; end if;
  if not exists (select 1 from public.ride_group_members where group_id = target_group.id and user_id = (select auth.uid()))
     and (select count(*) from public.ride_group_members where group_id = target_group.id) >= 2 then
    raise exception 'This shared space already has two riders';
  end if;
  insert into public.profiles (id, full_name) values ((select auth.uid()), member_name)
  on conflict (id) do update set full_name = excluded.full_name;
  insert into public.ride_group_members (group_id, user_id, display_name)
  values (target_group.id, (select auth.uid()), member_name)
  on conflict (group_id, user_id) do update set display_name = excluded.display_name;
  return target_group;
end;
$$;

create or replace function public.validate_ride_trip_members()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from public.ride_group_members where group_id = new.group_id and user_id = new.paid_by) then
    raise exception 'The payer must belong to this shared group';
  end if;
  if not exists (select 1 from public.ride_group_members where group_id = new.group_id and user_id = new.created_by) then
    raise exception 'The creator must belong to this shared group';
  end if;
  if new.settled_by is not null and not exists (select 1 from public.ride_group_members where group_id = new.group_id and user_id = new.settled_by) then
    raise exception 'The settling member must belong to this shared group';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists validate_ride_trip_members on public.ride_trips;
create trigger validate_ride_trip_members
before insert or update on public.ride_trips
for each row execute function public.validate_ride_trip_members();

-- This RPC writes the settlement and updates the trip together, so the ledger
-- cannot show a settled ride without a corresponding money transaction.
drop function if exists public.settle_ride_trip(uuid, text);
drop function if exists public.settle_ride_trip(uuid, text, uuid);
create or replace function public.settle_ride_trip(target_trip_id uuid, settlement_note text default null, settlement_paid_by uuid default null)
returns public.ride_settlements
language plpgsql
security definer
set search_path = public
as $$
declare current_trip public.ride_trips;
declare new_settlement public.ride_settlements;
declare caller_id uuid := (select auth.uid());
declare actual_paid_by uuid;
begin
  if caller_id is null then raise exception 'Sign in required'; end if;
  select * into current_trip from public.ride_trips where id = target_trip_id for update;
  if current_trip.id is null or not public.is_ride_group_member(current_trip.group_id) then
    raise exception 'Ride not found';
  end if;
  actual_paid_by := coalesce(settlement_paid_by, caller_id);
  if current_trip.trip_mode = 'solo' and current_trip.solo_by = caller_id then
    raise exception 'Solo rides are already billed to that rider and do not need a split settlement';
  end if;
  if actual_paid_by = current_trip.paid_by then raise exception 'The Uber payer cannot be marked as owing this ride'; end if;
  if not exists (select 1 from public.ride_group_members where group_id = current_trip.group_id and user_id = actual_paid_by) then
    raise exception 'The settling member must belong to this shared group';
  end if;
  if current_trip.settled_at is not null then raise exception 'This ride is already settled'; end if;
  insert into public.ride_settlements (group_id, trip_id, amount, paid_by, received_by, recorded_by, note)
  values (current_trip.group_id, current_trip.id, current_trip.amount / 2, actual_paid_by, current_trip.paid_by, caller_id, settlement_note)
  returning * into new_settlement;
  update public.ride_trips
  set settled_at = new_settlement.settled_at, settled_by = caller_id
  where id = current_trip.id;
  return new_settlement;
end;
$$;

-- Returns period analytics without exposing data outside the caller's shared space.
create or replace function public.ride_analytics(target_group_id uuid, starts_at timestamptz default null, ends_at timestamptz default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with scoped_trips as (
    select * from public.ride_trips
    where group_id = target_group_id
      and (starts_at is null or ride_at >= starts_at)
      and (ends_at is null or ride_at < ends_at)
  ), member_totals as (
    select m.user_id, m.display_name,
      coalesce(sum(t.amount) filter (where t.paid_by = m.user_id), 0) as paid_total,
      count(t.id) filter (where t.paid_by = m.user_id) as rides_paid
    from public.ride_group_members m
    left join scoped_trips t on true
    where m.group_id = target_group_id
    group by m.user_id, m.display_name
  )
  select jsonb_build_object(
    'rides', (select count(*) from scoped_trips),
    'days_active', (select count(distinct ride_at::date) from scoped_trips),
    'total_spend', (select coalesce(sum(amount), 0) from scoped_trips),
    'average_ride_cost', (select coalesce(avg(amount), 0) from scoped_trips),
    'campus_rides', (select count(*) from scoped_trips where direction = 'campus'),
    'home_rides', (select count(*) from scoped_trips where direction = 'home'),
    'member_totals', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', display_name, 'paid_total', paid_total, 'rides_paid', rides_paid)), '[]'::jsonb) from member_totals)
  );
$$;

alter table public.profiles enable row level security;
alter table public.ride_groups enable row level security;
alter table public.ride_group_members enable row level security;
alter table public.ride_trips enable row level security;
alter table public.ride_settlements enable row level security;

revoke all on public.profiles, public.ride_groups, public.ride_group_members, public.ride_trips, public.ride_settlements from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.ride_groups to authenticated;
grant select on public.ride_group_members to authenticated;
grant select, insert, update, delete on public.ride_trips to authenticated;
grant select on public.ride_settlements to authenticated;
revoke execute on function public.is_ride_group_member(uuid), public.create_ride_group(text, text), public.join_ride_group(text, text), public.settle_ride_trip(uuid, text, uuid), public.ride_analytics(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.is_ride_group_member(uuid), public.create_ride_group(text, text), public.join_ride_group(text, text), public.settle_ride_trip(uuid, text, uuid), public.ride_analytics(uuid, timestamptz, timestamptz) to authenticated;

create policy "Read your profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Create your profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "Edit your profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Read your groups" on public.ride_groups for select to authenticated using (public.is_ride_group_member(id));
create policy "Read members in your groups" on public.ride_group_members for select to authenticated using (public.is_ride_group_member(group_id));
create policy "Read shared trips" on public.ride_trips for select to authenticated using (public.is_ride_group_member(group_id));
create policy "Create shared trips" on public.ride_trips for insert to authenticated with check (public.is_ride_group_member(group_id) and created_by = (select auth.uid()));
create policy "Edit shared trips" on public.ride_trips for update to authenticated using (public.is_ride_group_member(group_id)) with check (public.is_ride_group_member(group_id));
create policy "Delete shared trips" on public.ride_trips for delete to authenticated using (public.is_ride_group_member(group_id));
create policy "Read shared settlements" on public.ride_settlements for select to authenticated using (public.is_ride_group_member(group_id));
