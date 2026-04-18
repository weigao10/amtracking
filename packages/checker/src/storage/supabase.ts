/**
 * SupabaseStorage — IStorage implementation backed by a Supabase (Postgres) project.
 *
 * All database interactions go through the @supabase/supabase-js client so no
 * raw SQL is executed here; schema lives in supabase/migrations/001_initial.sql.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  AlertRecord,
  AlertType,
  IStorage,
  NewAlertRecord,
  NewSnapshot,
  PriceSnapshot,
} from "./interface";

// ─── DB row shapes (mirror the SQL schema column names) ───────────────────────

interface SnapshotRow {
  id: string;
  watch_id: string;
  price: number;
  seats_available: number | null;
  checked_at: string;
}

interface AlertRow {
  id: string;
  watch_id: string;
  alert_type: string;
  price: number;
  historic_low_at_time: number | null;
  sent_at: string;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function snapshotFromRow(row: SnapshotRow): PriceSnapshot {
  return {
    id: row.id,
    watchId: row.watch_id,
    price: row.price,
    seatsAvailable: row.seats_available,
    checkedAt: row.checked_at,
  };
}

function alertFromRow(row: AlertRow): AlertRecord {
  return {
    id: row.id,
    watchId: row.watch_id,
    alertType: row.alert_type as AlertType,
    price: row.price,
    historicLowAtTime: row.historic_low_at_time,
    sentAt: row.sent_at,
  };
}

// ─── SupabaseStorage ──────────────────────────────────────────────────────────

export class SupabaseStorage implements IStorage {
  private readonly db: SupabaseClient;

  constructor(supabaseUrl: string, supabaseAnonKey: string) {
    this.db = createClient(supabaseUrl, supabaseAnonKey);
  }

  // ── Snapshots ──────────────────────────────────────────────────────────────

  async getLastSnapshot(watchId: string): Promise<PriceSnapshot | null> {
    const { data, error } = await this.db
      .from("price_snapshots")
      .select("*")
      .eq("watch_id", watchId)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`getLastSnapshot failed: ${error.message}`);
    if (!data) return null;
    return snapshotFromRow(data as SnapshotRow);
  }

  async getHistoricLow(watchId: string): Promise<number | null> {
    const { data, error } = await this.db
      .from("price_snapshots")
      .select("price")
      .eq("watch_id", watchId)
      .order("price", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`getHistoricLow failed: ${error.message}`);
    if (!data) return null;
    return (data as { price: number }).price;
  }

  async saveSnapshot(snapshot: NewSnapshot): Promise<void> {
    const row: Omit<SnapshotRow, "id"> = {
      watch_id: snapshot.watchId,
      price: snapshot.price,
      seats_available: snapshot.seatsAvailable,
      checked_at: snapshot.checkedAt,
    };

    const { error } = await this.db.from("price_snapshots").insert(row);
    if (error) throw new Error(`saveSnapshot failed: ${error.message}`);
  }

  // ── Alerts ─────────────────────────────────────────────────────────────────

  async wasAlertSentRecently(
    watchId: string,
    alertType: AlertType,
    cooldownHours: number
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.db
      .from("alerts")
      .select("id")
      .eq("watch_id", watchId)
      .eq("alert_type", alertType)
      .gte("sent_at", cutoff)
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`wasAlertSentRecently failed: ${error.message}`);
    return data !== null;
  }

  async saveAlertRecord(record: NewAlertRecord): Promise<void> {
    const row: Omit<AlertRow, "id"> = {
      watch_id: record.watchId,
      alert_type: record.alertType,
      price: record.price,
      historic_low_at_time: record.historicLowAtTime,
      sent_at: record.sentAt,
    };

    const { error } = await this.db.from("alerts").insert(row);
    if (error) throw new Error(`saveAlertRecord failed: ${error.message}`);
  }
}
