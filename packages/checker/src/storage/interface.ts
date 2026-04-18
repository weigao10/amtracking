/**
 * IStorage — adapter interface for persisting price snapshots and alert logs.
 *
 * Concrete implementations (e.g. SupabaseStorage) must satisfy this contract
 * so the job logic stays storage-agnostic.
 */

import { TravelClass } from "../amtrak/types";

// ─── Domain models ────────────────────────────────────────────────────────────

export interface Watch {
  id: string;
  origin: string;
  destination: string;
  /** ISO date string, e.g. "2026-06-15" */
  date: string;
  class: TravelClass;
  targetPrice: number;
  active: boolean;
  createdAt: string;
}

export interface PriceSnapshot {
  id: string;
  watchId: string;
  price: number;
  seatsAvailable: number | null;
  /** ISO timestamp */
  checkedAt: string;
}

export type AlertType = "below_target" | "price_drop" | "near_historic_low";

export interface AlertRecord {
  id: string;
  watchId: string;
  alertType: AlertType;
  price: number;
  historicLowAtTime: number | null;
  sentAt: string;
}

// ─── Input types (for inserts — no generated fields) ─────────────────────────

export type NewSnapshot = Omit<PriceSnapshot, "id">;
export type NewAlertRecord = Omit<AlertRecord, "id">;

// ─── IStorage interface ───────────────────────────────────────────────────────

export interface IStorage {
  /**
   * Fetch the most recent snapshot for a given watch, or null if none exist.
   */
  getLastSnapshot(watchId: string): Promise<PriceSnapshot | null>;

  /**
   * Fetch the cheapest (historic low) price ever recorded for a watch.
   * Returns null when there are no snapshots yet.
   */
  getHistoricLow(watchId: string): Promise<number | null>;

  /**
   * Persist a new price snapshot.
   */
  saveSnapshot(snapshot: NewSnapshot): Promise<void>;

  /**
   * Check whether an alert of a given type was sent for a watch within
   * the last `cooldownHours` hours.
   *
   * Used to suppress duplicate notifications.
   */
  wasAlertSentRecently(
    watchId: string,
    alertType: AlertType,
    cooldownHours: number
  ): Promise<boolean>;

  /**
   * Persist an alert record for deduplication tracking.
   */
  saveAlertRecord(record: NewAlertRecord): Promise<void>;
}
