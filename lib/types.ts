export type Direction = "campus" | "home";

export type Member = {
  user_id: string;
  display_name: string;
};

export type Trip = {
  id: string;
  ride_at: string;
  direction: Direction;
  amount: number;
  paid_by: string;
  notes: string | null;
  settled_at: string | null;
  settled_by: string | null;
};

export type RideGroup = {
  id: string;
  name: string;
  invite_code: string;
};
