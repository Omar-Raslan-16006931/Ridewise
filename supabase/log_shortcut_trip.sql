-- ===========================================================================
-- Ridewise: iOS Shortcut Database Function (Run in Supabase SQL Editor)
-- Allows iOS Shortcuts to log rides securely using your group invite code
-- ===========================================================================

create or replace function public.log_shortcut_trip(
  p_group_code text,
  p_amount numeric,
  p_trip_mode text default 'shared',
  p_payer text default null,
  p_notes text default null,
  p_direction text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group public.ride_groups;
  target_payer public.ride_group_members;
  final_direction text;
  final_mode text;
  final_notes text;
  new_trip public.ride_trips;
begin
  -- 1. Find group by invite code (case-insensitive)
  select * into target_group from public.ride_groups
  where upper(trim(invite_code)) = upper(trim(p_group_code));

  if target_group.id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid group code: ' || coalesce(p_group_code, 'empty'));
  end if;

  -- 2. Validate Amount
  if p_amount is null or p_amount <= 0 or p_amount >= 100000 then
    return jsonb_build_object('success', false, 'error', 'Amount must be a positive number under 100,000');
  end if;

  -- 3. Validate Mode
  final_mode := lower(trim(coalesce(p_trip_mode, 'shared')));
  if final_mode not in ('shared', 'solo') then
    final_mode := 'shared';
  end if;

  -- 4. Match Payer by UUID or display name
  if p_payer is not null and trim(p_payer) <> '' then
    select * into target_payer from public.ride_group_members
    where group_id = target_group.id
      and (user_id::text = trim(p_payer) or lower(display_name) = lower(trim(p_payer)))
    limit 1;
  end if;

  if target_payer.user_id is null then
    select * into target_payer from public.ride_group_members
    where group_id = target_group.id
    order by joined_at asc
    limit 1;
  end if;

  if target_payer.user_id is null then
    return jsonb_build_object('success', false, 'error', 'No members found in this group');
  end if;

  -- 5. Direction (default to campus before 1 PM Cairo time, home after)
  final_direction := lower(trim(coalesce(p_direction, '')));
  if final_direction not in ('campus', 'home') then
    final_direction := case when extract(hour from now() at time zone 'Africa/Cairo') < 13 then 'campus' else 'home' end;
  end if;

  final_notes := coalesce(p_notes, 'Logged via iOS Shortcut');

  -- 6. Insert trip (SECURITY DEFINER allows inserting without authenticated session)
  insert into public.ride_trips (
    group_id,
    ride_at,
    direction,
    amount,
    trip_mode,
    solo_by,
    paid_by,
    created_by,
    notes
  ) values (
    target_group.id,
    now(),
    final_direction,
    p_amount,
    final_mode,
    case when final_mode = 'solo' then target_payer.user_id else null end,
    target_payer.user_id,
    target_payer.user_id,
    final_notes
  ) returning * into new_trip;

  return jsonb_build_object(
    'success', true,
    'trip', jsonb_build_object(
      'id', new_trip.id,
      'amount', new_trip.amount,
      'trip_mode', new_trip.trip_mode,
      'paid_by', target_payer.display_name,
      'direction', new_trip.direction
    )
  );
end;
$$;

-- Grant execution to anon and authenticated roles
revoke all on function public.log_shortcut_trip(text, numeric, text, text, text, text) from public;
grant execute on function public.log_shortcut_trip(text, numeric, text, text, text, text) to anon, authenticated;
