-- Run this once in the existing Supabase project's SQL Editor.

drop function if exists public.settle_ride_trip(uuid, text);
drop function if exists public.settle_ride_trip(uuid, text, uuid);

create or replace function public.settle_ride_trip(
  target_trip_id uuid,
  settlement_note text default null,
  settlement_paid_by uuid default null
)
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

revoke execute on function public.settle_ride_trip(uuid, text, uuid) from public, anon;
grant execute on function public.settle_ride_trip(uuid, text, uuid) to authenticated;