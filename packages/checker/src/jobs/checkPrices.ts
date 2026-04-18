/**
 * checkPrices — main job entry point.
 *
 * Orchestrates the full price-check cycle:
 *   1. Load watched routes from config.json
 *   2. For each active watch: fetch price, compare with history, fire alerts
 *   3. Persist snapshots and alert records to Supabase
 *
 * Run locally:  npm run check --workspace=packages/checker
 * Dry-run mode: DRY_RUN=true npm run check --workspace=packages/checker
 */

import { AmtrakClient } from "../amtrak/client";
import { AppConfig, loadConfig, WatchEntry } from "../config";
import { AlertPayload, INotifier } from "../notifications/interface";
import { EmailNotifier } from "../notifications/email";
import { AlertType, IStorage, NewAlertRecord, NewSnapshot } from "../storage/interface";
import { SupabaseStorage } from "../storage/supabase";

// ─── Alert cooldowns (hours) ──────────────────────────────────────────────────

const COOLDOWN: Record<AlertType, number> = {
  below_target: 24,
  price_drop: 6,
  near_historic_low: 24,
};

/** Price must be within this fraction above historic low to trigger the alert. */
const NEAR_HISTORIC_LOW_THRESHOLD = 0.10; // 10 %

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a station-pair as a human-readable route, e.g. "NYP → WAS". */
function routeLabel(origin: string, destination: string): string {
  return `${origin} → ${destination}`;
}

/**
 * Format an ISO date string as a short human label, e.g. "Jun 15, 2026".
 * Uses UTC to avoid timezone shifts on the date itself.
 */
function dateLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ─── Single-watch processing ──────────────────────────────────────────────────

interface ProcessResult {
  watchId: string;
  route: string;
  price: number | null;
  alertsSent: AlertType[];
  skipped: boolean;
  error?: string;
}

async function processWatch(
  watch: WatchEntry,
  amtrak: AmtrakClient,
  storage: IStorage,
  notifier: INotifier,
  config: AppConfig
): Promise<ProcessResult> {
  const route = routeLabel(watch.origin, watch.destination);
  const result: ProcessResult = {
    watchId: watch.id,
    route,
    price: null,
    alertsSent: [],
    skipped: false,
  };

  if (!watch.active) {
    result.skipped = true;
    return result;
  }

  // ── 1. Fetch current price ─────────────────────────────────────────────────
  let currentPrice: number | null = null;
  let seatsAvailable: number | null = null;

  try {
    const fareResult = await amtrak.getCheapestFare(
      watch.origin,
      watch.destination,
      watch.date,
      watch.class
    );
    if (fareResult) {
      currentPrice = fareResult.price;
      seatsAvailable = fareResult.seatsAvailable;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Amtrak API error: ${message}`;
    console.error(`[${route}] ${result.error}`);
    return result;
  }

  result.price = currentPrice;

  if (currentPrice === null) {
    console.log(`[${route}] No fares available for ${watch.class} on ${watch.date}`);
    return result;
  }

  console.log(`[${route}] Current price: $${currentPrice} (${watch.class}, ${watch.date})`);

  // ── 2. Load historical data ────────────────────────────────────────────────
  const [lastSnapshot, historicLow] = await Promise.all([
    storage.getLastSnapshot(watch.id),
    storage.getHistoricLow(watch.id),
  ]);

  const lastPrice = lastSnapshot?.price ?? null;

  // ── 3. Evaluate alert conditions ───────────────────────────────────────────
  const now = new Date().toISOString();
  const dl = dateLabel(watch.date);
  const pendingAlerts: Array<{ type: AlertType; payload: AlertPayload }> = [];

  // below_target
  if (currentPrice < watch.targetPrice) {
    const recent = await storage.wasAlertSentRecently(
      watch.id,
      "below_target",
      COOLDOWN.below_target
    );
    if (!recent) {
      pendingAlerts.push({
        type: "below_target",
        payload: {
          alertType: "below_target",
          route,
          dateLabel: dl,
          currentPrice,
          targetPrice: watch.targetPrice,
        },
      });
    } else {
      console.log(`[${route}] below_target suppressed (within cooldown)`);
    }
  }

  // price_drop — only if we have a prior snapshot to compare against
  if (lastPrice !== null && currentPrice < lastPrice) {
    const recent = await storage.wasAlertSentRecently(
      watch.id,
      "price_drop",
      COOLDOWN.price_drop
    );
    if (!recent) {
      pendingAlerts.push({
        type: "price_drop",
        payload: {
          alertType: "price_drop",
          route,
          dateLabel: dl,
          currentPrice,
          previousPrice: lastPrice,
        },
      });
    } else {
      console.log(`[${route}] price_drop suppressed (within cooldown)`);
    }
  }

  // near_historic_low — only when we have a meaningful historic baseline
  if (historicLow !== null && historicLow > 0) {
    const pctAbove = (currentPrice - historicLow) / historicLow;
    if (pctAbove >= 0 && pctAbove <= NEAR_HISTORIC_LOW_THRESHOLD) {
      const recent = await storage.wasAlertSentRecently(
        watch.id,
        "near_historic_low",
        COOLDOWN.near_historic_low
      );
      if (!recent) {
        pendingAlerts.push({
          type: "near_historic_low",
          payload: {
            alertType: "near_historic_low",
            route,
            dateLabel: dl,
            currentPrice,
            historicLow,
          },
        });
      } else {
        console.log(`[${route}] near_historic_low suppressed (within cooldown)`);
      }
    }
  }

  // ── 4. Save snapshot ───────────────────────────────────────────────────────
  const snapshot: NewSnapshot = {
    watchId: watch.id,
    price: currentPrice,
    seatsAvailable,
    checkedAt: now,
  };

  if (config.dryRun) {
    console.log(`[${route}] DRY RUN — would save snapshot:`, snapshot);
  } else {
    await storage.saveSnapshot(snapshot);
    console.log(`[${route}] Snapshot saved ($${currentPrice})`);
  }

  // ── 5. Send alerts and record them ─────────────────────────────────────────
  for (const { type, payload } of pendingAlerts) {
    if (config.dryRun) {
      console.log(`[${route}] DRY RUN — would send ${type} alert:`, payload);
      result.alertsSent.push(type);
      continue;
    }

    try {
      await notifier.sendAlert(payload);

      const alertRecord: NewAlertRecord = {
        watchId: watch.id,
        alertType: type,
        price: currentPrice,
        historicLowAtTime: payload.historicLow ?? null,
        sentAt: now,
      };
      await storage.saveAlertRecord(alertRecord);
      result.alertsSent.push(type);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${route}] Failed to send ${type} alert: ${message}`);
    }
  }

  return result;
}

// ─── Job runner ───────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log("=== Amtracking price check started ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);

  // Load config — throws with a clear message on missing env vars
  const config = loadConfig();

  if (config.dryRun) {
    console.log("DRY RUN mode — no writes or emails will be sent");
  }

  const amtrak = new AmtrakClient();
  const storage = new SupabaseStorage(config.supabaseUrl, config.supabaseAnonKey);
  const notifier = new EmailNotifier({
    gmailUser: config.gmailUser,
    gmailAppPassword: config.gmailAppPassword,
    alertEmail: config.alertEmail,
  });

  const activeWatches = config.watches.filter((w) => w.active);
  console.log(`Processing ${activeWatches.length} active watch(es)...\n`);

  const results: ProcessResult[] = [];

  for (const watch of config.watches) {
    try {
      const result = await processWatch(watch, amtrak, storage, notifier, config);
      results.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Unhandled error for watch ${watch.id}: ${message}`);
      results.push({
        watchId: watch.id,
        route: routeLabel(watch.origin, watch.destination),
        price: null,
        alertsSent: [],
        skipped: false,
        error: message,
      });
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n=== Summary ===");
  for (const r of results) {
    if (r.skipped) {
      console.log(`  ${r.route} — skipped (inactive)`);
    } else if (r.error) {
      console.log(`  ${r.route} — ERROR: ${r.error}`);
    } else {
      const alertStr = r.alertsSent.length > 0 ? `, alerts: ${r.alertsSent.join(", ")}` : "";
      console.log(`  ${r.route} — $${r.price ?? "N/A"}${alertStr}`);
    }
  }

  const errors = results.filter((r) => r.error);
  if (errors.length > 0) {
    console.error(`\n${errors.length} watch(es) had errors — see above.`);
    process.exit(1);
  }

  console.log("\n=== Done ===");
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

run().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
