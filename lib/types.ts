export type Direction = "campus" | "home";
export type TripMode = "shared" | "solo";

export type Member = {
  user_id: string;
  display_name: string;
};

export type Trip = {
  id: string;
  ride_at: string;
  direction: Direction;
  amount: number;
  trip_mode: TripMode;
  solo_by: string | null;
  paid_by: string;
  notes: string | null;
  settled_at: string | null;
  settled_by: string | null;
  created_at?: string;
};

export type RideGroup = {
  id: string;
  name: string;
  invite_code: string;
};
