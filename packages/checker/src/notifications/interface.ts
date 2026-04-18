/**
 * INotifier — adapter interface for sending price-alert notifications.
 *
 * Decouple the job logic from the delivery mechanism so alternative
 * notifiers (SMS, Slack, etc.) can be swapped in without changing job code.
 */

import { AlertType } from "../storage/interface";

// ─── Notification payload ─────────────────────────────────────────────────────

export interface AlertPayload {
  /** Which alert condition triggered this notification. */
  alertType: AlertType;

  /** Human-readable route label, e.g. "NYP → WAS" */
  route: string;

  /** Human-readable date label, e.g. "Jun 15, 2026" */
  dateLabel: string;

  /** Current price in USD */
  currentPrice: number;

  /** User's target price (for below_target alerts) */
  targetPrice?: number;

  /** Previous price in the last snapshot (for price_drop alerts) */
  previousPrice?: number;

  /** All-time historic low at the time of this alert (for near_historic_low alerts) */
  historicLow?: number;
}

// ─── INotifier interface ──────────────────────────────────────────────────────

export interface INotifier {
  /**
   * Send a single alert notification.
   * Implementations should throw on unrecoverable delivery failure.
   */
  sendAlert(payload: AlertPayload): Promise<void>;
}
