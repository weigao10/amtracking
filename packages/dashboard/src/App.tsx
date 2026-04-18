/**
 * App — Amtracking price history dashboard (Phase 2 scaffold).
 *
 * Fetches price_snapshots from Supabase and renders a line chart per watched
 * route using Recharts. Full feature implementation is Phase 2.
 *
 * Required env vars (set in .env at repo root or packages/dashboard/.env):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY
 */

import { useEffect, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

// ─── Supabase client ──────────────────────────────────────────────────────────

const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"] as string;
const supabaseAnonKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string;

let supabase: SupabaseClient | null = null;
if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Watch {
  id: string;
  origin: string;
  destination: string;
  date: string;
  class: string;
  target_price: number;
  active: boolean;
}

interface Snapshot {
  id: string;
  watch_id: string;
  price: number;
  seats_available: number | null;
  checked_at: string;
}

interface ChartDataPoint {
  time: string;
  price: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PriceChart({
  watch,
  snapshots,
}: {
  watch: Watch;
  snapshots: Snapshot[];
}) {
  const data: ChartDataPoint[] = snapshots
    .slice()
    .sort((a, b) => a.checked_at.localeCompare(b.checked_at))
    .map((s) => ({
      time: new Date(s.checked_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      price: s.price,
    }));

  const routeLabel = `${watch.origin} → ${watch.destination}`;
  const dateLabel = new Date(`${watch.date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  const minPrice = data.length > 0 ? Math.min(...data.map((d) => d.price)) : 0;
  const maxPrice = data.length > 0 ? Math.max(...data.map((d) => d.price)) : 200;

  return (
    <div style={{ marginBottom: "2.5rem" }}>
      <h2 style={{ marginBottom: "0.25rem" }}>
        {routeLabel} &mdash; {dateLabel}
      </h2>
      <p style={{ margin: "0 0 1rem", color: "#666", fontSize: "0.9rem" }}>
        Class: {watch.class} &nbsp;|&nbsp; Target: ${watch.target_price} &nbsp;|&nbsp;{" "}
        {data.length} data point{data.length !== 1 ? "s" : ""}
      </p>

      {data.length === 0 ? (
        <p style={{ color: "#888" }}>No snapshots recorded yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" tick={{ fontSize: 11 }} />
            <YAxis
              domain={[Math.max(0, minPrice - 20), maxPrice + 20]}
              tickFormatter={(v: number) => `$${v}`}
              tick={{ fontSize: 11 }}
            />
            <Tooltip formatter={(v: number) => [`$${v}`, "Price"]} />
            <Legend />
            {/* Target price reference — rendered as a constant data key */}
            <Line
              type="monotone"
              dataKey="price"
              stroke="#2563eb"
              strokeWidth={2}
              dot={false}
              name="Price"
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [snapshotsByWatch, setSnapshotsByWatch] = useState<Record<string, Snapshot[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setError(
        "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY " +
          "in your .env file and restart the dev server."
      );
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        const db = supabase!;

        const { data: watchData, error: watchErr } = await db
          .from("watches")
          .select("*")
          .eq("active", true)
          .order("created_at", { ascending: true });

        if (watchErr) throw new Error(watchErr.message);

        const typedWatches = (watchData ?? []) as Watch[];
        setWatches(typedWatches);

        if (typedWatches.length === 0) {
          setLoading(false);
          return;
        }

        const watchIds = typedWatches.map((w) => w.id);

        const { data: snapData, error: snapErr } = await db
          .from("price_snapshots")
          .select("*")
          .in("watch_id", watchIds)
          .order("checked_at", { ascending: true });

        if (snapErr) throw new Error(snapErr.message);

        const grouped: Record<string, Snapshot[]> = {};
        for (const snap of (snapData ?? []) as Snapshot[]) {
          if (!grouped[snap.watch_id]) grouped[snap.watch_id] = [];
          grouped[snap.watch_id].push(snap);
        }

        setSnapshotsByWatch(grouped);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    void fetchData();
  }, []);

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        maxWidth: "900px",
        margin: "0 auto",
        padding: "2rem 1rem",
      }}
    >
      <h1 style={{ borderBottom: "2px solid #e5e7eb", paddingBottom: "0.75rem" }}>
        Amtracking — Price History
      </h1>

      {loading && <p>Loading data from Supabase&hellip;</p>}

      {error && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: "6px",
            padding: "1rem",
            color: "#991b1b",
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && watches.length === 0 && (
        <p style={{ color: "#6b7280" }}>
          No active watches found. Add entries to the <code>watches</code> table in Supabase
          or to <code>packages/checker/config.json</code> and run the checker.
        </p>
      )}

      {watches.map((watch) => (
        <PriceChart
          key={watch.id}
          watch={watch}
          snapshots={snapshotsByWatch[watch.id] ?? []}
        />
      ))}
    </div>
  );
}
