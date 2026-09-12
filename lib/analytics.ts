import type { Member, Trip } from "./types";

export type MemberSpend = {
  user_id: string;
  display_name: string;
  totalSpend: number;
  shareOfSpend: number;
  rides: number;
};

export type MemberPaid = {
  user_id: string;
  display_name: string;
  paidTotal: number;
  shareOfSpend: number;
  ridesPaid: number;
};

export type AnalyticsSummary = {
  totalSpend: number;
  totalPaidByMember: MemberPaid[];
  totalByMember: MemberSpend[];
  tripCounts: {
    total: number;
    shared: number;
    solo: number;
    campus: number;
    home: number;
  };
  sharedTrips: number;
  soloTrips: number;
  paidBy: Record<string, number>;
};

export function getTripShareForMember(trip: Trip, memberId: string) {
  if (trip.trip_mode === "solo") return trip.solo_by === memberId ? trip.amount : 0;
  return trip.amount / 2;
}

export function summarizeTrips(trips: Trip[], members: Member[]): AnalyticsSummary {
  const totalSpend = trips.reduce((sum, trip) => sum + trip.amount, 0);
  const sharedTrips = trips.filter((trip) => trip.trip_mode === "shared").length;
  const soloTrips = trips.filter((trip) => trip.trip_mode === "solo").length;

  const totalByMember: MemberSpend[] = members.map((member) => {
    const memberTrips = trips.filter((trip) => getTripShareForMember(trip, member.user_id) > 0);
    const totalSpendForMember = memberTrips.reduce((sum, trip) => sum + getTripShareForMember(trip, member.user_id), 0);

    return {
      user_id: member.user_id,
      display_name: member.display_name,
      totalSpend: totalSpendForMember,
      shareOfSpend: totalSpend ? (totalSpendForMember / totalSpend) * 100 : 0,
      rides: memberTrips.length,
    };
  });

  const totalPaidByMember: MemberPaid[] = members.map((member) => {
    const paidTrips = trips.filter((trip) => trip.paid_by === member.user_id);
    const paidTotal = paidTrips.reduce((sum, trip) => sum + trip.amount, 0);
    return {
      user_id: member.user_id,
      display_name: member.display_name,
      paidTotal,
      shareOfSpend: totalSpend ? (paidTotal / totalSpend) * 100 : 0,
      ridesPaid: paidTrips.length,
    };
  });

  const paidBy = Object.fromEntries(
    members.map((member) => [member.user_id, trips.filter((trip) => trip.paid_by === member.user_id).reduce((sum, trip) => sum + trip.amount, 0)]),
  ) as Record<string, number>;

  return {
    totalSpend,
    totalPaidByMember,
    totalByMember,
    tripCounts: {
      total: trips.length,
      shared: sharedTrips,
      solo: soloTrips,
      campus: trips.filter((trip) => trip.direction === "campus").length,
      home: trips.filter((trip) => trip.direction === "home").length,
    },
    sharedTrips,
    soloTrips,
    paidBy,
  };
}
