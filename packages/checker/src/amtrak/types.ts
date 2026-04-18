/**
 * Types for Amtrak trip data returned from the unofficial internal API.
 * Field names mirror the actual API response where known.
 */

export type TravelClass = "coach" | "business" | "sleeper";

/** A single fare option within a trip segment. */
export interface AmtrakFare {
  /** Display name, e.g. "Coach", "Business", "Roomette" */
  name: string;
  /** Numeric price in USD */
  price: number;
  /** Seats / rooms remaining, null when unavailable */
  seatsAvailable: number | null;
  /** Whether this fare class is bookable right now */
  available: boolean;
}

/** One train trip result (a single departure on the requested date). */
export interface AmtrakTrip {
  /** Train number, e.g. "2151" */
  trainNumber: string;
  /** Station code origin */
  origin: string;
  /** Station code destination */
  destination: string;
  /** Scheduled departure ISO string */
  departureTime: string;
  /** Scheduled arrival ISO string */
  arrivalTime: string;
  /** Travel duration in minutes */
  durationMinutes: number;
  /** Available fares keyed by class */
  fares: AmtrakFare[];
}

/** Parsed result of a single price-check for one watch entry. */
export interface PriceCheckResult {
  /** Watch ID from config.json */
  watchId: string;
  origin: string;
  destination: string;
  /** ISO date string, e.g. "2026-06-15" */
  date: string;
  travelClass: TravelClass;
  /** Cheapest matching fare found, null if sold out / no trains */
  price: number | null;
  /** Seats available for the cheapest fare, null when unknown */
  seatsAvailable: number | null;
  /** ISO timestamp of when this check ran */
  checkedAt: string;
}

/** Raw request body for the Amtrak trip search endpoint. */
export interface AmtrakTripRequest {
  wdf_TripType: string;
  wdf_origin: string;
  wdf_destination: string;
  wdf_travel_date: string;
  wdf_num_adults: string;
  _handler: string;
}
