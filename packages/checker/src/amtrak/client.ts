/**
 * Amtrak API client using the unofficial internal trip-search endpoint.
 *
 * IMPORTANT: This endpoint is NOT part of any public API contract.
 * Amtrak may change or remove it without notice. If requests start
 * failing, inspect network traffic on amtrak.com to find the current
 * endpoint and request/response shape.
 *
 * TODO: Verify the exact endpoint URL and response schema by capturing
 *       a live request from amtrak.com before running in production.
 */

import axios, { AxiosInstance } from "axios";
import { AmtrakFare, AmtrakTrip, AmtrakTripRequest, TravelClass } from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Unofficial Amtrak internal trip-search endpoint.
 * Captured from browser network traffic on amtrak.com search flow.
 */
const AMTRAK_TRIP_ENDPOINT =
  "https://www.amtrak.com/services/amtrip.guest.trip.get.v1.html";

const DEFAULT_HEADERS: Record<string, string> = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  Origin: "https://www.amtrak.com",
  Referer: "https://www.amtrak.com/",
};

// ─── Response shape (may drift from actual API — update as needed) ────────────

interface RawFare {
  fareName?: string;
  fare?: number | string;
  availableSeats?: number | string | null;
  soldOut?: boolean;
}

interface RawTrain {
  trainNumber?: string;
  originCode?: string;
  destinationCode?: string;
  departDateTime?: string;
  arriveDateTime?: string;
  travelTime?: number;
  fares?: RawFare[];
  // Alternative field names seen in some response versions
  trainNo?: string;
  origin?: string;
  destination?: string;
}

interface RawAmtrakResponse {
  trains?: RawTrain[];
  // Some response versions nest under a "trip" key
  trip?: { trains?: RawTrain[] };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert "06/15/2026" or "2026-06-15" to Amtrak's expected "MM/DD/YYYY". */
function toAmtrakDateFormat(date: string): string {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) return date;
  // ISO format: YYYY-MM-DD
  const [year, month, day] = date.split("-");
  return `${month}/${day}/${year}`;
}

/** Normalise a raw fare class name to our internal TravelClass enum. */
function normaliseFareClass(rawName: string): TravelClass | null {
  const lower = rawName.toLowerCase();
  if (lower.includes("coach")) return "coach";
  if (lower.includes("business")) return "business";
  if (lower.includes("roomette") || lower.includes("bedroom") || lower.includes("sleeper")) {
    return "sleeper";
  }
  return null;
}

/** Parse a raw fare array into typed AmtrakFare objects. */
function parseFares(rawFares: RawFare[]): AmtrakFare[] {
  return rawFares
    .filter((f) => f.fare !== undefined && f.fare !== null)
    .map((f): AmtrakFare => {
      const price = typeof f.fare === "string" ? parseFloat(f.fare) : (f.fare ?? 0);
      const rawSeats = f.availableSeats;
      const seatsAvailable =
        rawSeats === null || rawSeats === undefined
          ? null
          : typeof rawSeats === "string"
          ? parseInt(rawSeats, 10)
          : rawSeats;

      return {
        name: f.fareName ?? "Unknown",
        price,
        seatsAvailable: Number.isNaN(seatsAvailable as number) ? null : seatsAvailable,
        available: !(f.soldOut ?? false) && price > 0,
      };
    });
}

/** Parse raw train array into typed AmtrakTrip objects. */
function parseTrains(rawTrains: RawTrain[]): AmtrakTrip[] {
  return rawTrains.map((t): AmtrakTrip => {
    const fares = parseFares(t.fares ?? []);
    // Calculate duration from datetime strings when travelTime is absent
    let durationMinutes = t.travelTime ?? 0;
    if (durationMinutes === 0 && t.departDateTime && t.arriveDateTime) {
      const dep = new Date(t.departDateTime).getTime();
      const arr = new Date(t.arriveDateTime).getTime();
      if (!Number.isNaN(dep) && !Number.isNaN(arr)) {
        durationMinutes = Math.round((arr - dep) / 60000);
      }
    }

    return {
      trainNumber: t.trainNumber ?? t.trainNo ?? "Unknown",
      origin: t.originCode ?? t.origin ?? "",
      destination: t.destinationCode ?? t.destination ?? "",
      departureTime: t.departDateTime ?? "",
      arrivalTime: t.arriveDateTime ?? "",
      durationMinutes,
      fares,
    };
  });
}

// ─── AmtrakClient ─────────────────────────────────────────────────────────────

export class AmtrakClient {
  private readonly http: AxiosInstance;

  constructor(timeoutMs = 30_000) {
    this.http = axios.create({
      timeout: timeoutMs,
      headers: DEFAULT_HEADERS,
    });
  }

  /**
   * Search for trips between two stations on a given date and return parsed
   * AmtrakTrip objects.
   *
   * @param origin      - Station code, e.g. "NYP"
   * @param destination - Station code, e.g. "WAS"
   * @param date        - ISO date "YYYY-MM-DD" or "MM/DD/YYYY"
   */
  async searchTrips(origin: string, destination: string, date: string): Promise<AmtrakTrip[]> {
    const requestBody: AmtrakTripRequest = {
      wdf_TripType: "1",
      wdf_origin: origin.toUpperCase(),
      wdf_destination: destination.toUpperCase(),
      wdf_travel_date: toAmtrakDateFormat(date),
      wdf_num_adults: "1",
      _handler:
        "amtrak.presentation.handler.request.AmtripGuestTripGetRequestHandler",
    };

    // Encode as application/x-www-form-urlencoded
    const encoded = new URLSearchParams(
      requestBody as unknown as Record<string, string>
    ).toString();

    const response = await this.http.post<RawAmtrakResponse>(
      AMTRAK_TRIP_ENDPOINT,
      encoded
    );

    const data = response.data;

    // Handle both response shapes observed in the wild
    const rawTrains: RawTrain[] =
      data.trains ?? data.trip?.trains ?? [];

    return parseTrains(rawTrains);
  }

  /**
   * Find the cheapest available fare for a specific travel class across all
   * trains on the given date.
   *
   * Returns { price, seatsAvailable } or null if nothing is available.
   */
  async getCheapestFare(
    origin: string,
    destination: string,
    date: string,
    travelClass: TravelClass
  ): Promise<{ price: number; seatsAvailable: number | null } | null> {
    const trips = await this.searchTrips(origin, destination, date);

    let bestPrice: number | null = null;
    let bestSeats: number | null = null;

    for (const trip of trips) {
      for (const fare of trip.fares) {
        if (!fare.available) continue;
        const fareClass = normaliseFareClass(fare.name);
        if (fareClass !== travelClass) continue;
        if (bestPrice === null || fare.price < bestPrice) {
          bestPrice = fare.price;
          bestSeats = fare.seatsAvailable;
        }
      }
    }

    if (bestPrice === null) return null;
    return { price: bestPrice, seatsAvailable: bestSeats };
  }
}
