/**
 * Configuration loader.
 *
 * Reads environment variables (from .env in local dev, GitHub Secrets in CI)
 * and the watched-routes config.json. Throws early with a clear message if
 * any required variable is missing.
 */

import * as fs from "fs";
import * as path from "path";
import { TravelClass } from "./amtrak/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WatchEntry {
  /** Unique string ID (must match the `id` in Supabase watches table or config) */
  id: string;
  origin: string;
  destination: string;
  /** ISO date, e.g. "2026-06-15" */
  date: string;
  targetPrice: number;
  class: TravelClass;
  active: boolean;
}

export interface ConfigFile {
  watches: WatchEntry[];
}

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  gmailUser: string;
  gmailAppPassword: string;
  alertEmail: string;
  /** Set DRY_RUN=true to skip saving to DB and sending emails (useful in dev) */
  dryRun: boolean;
  watches: WatchEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill in your values.`
    );
  }
  return value.trim();
}

function loadConfigFile(): ConfigFile {
  // config.json lives alongside package.json in packages/checker/
  const configPath = path.resolve(__dirname, "..", "config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(`config.json not found at ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(raw) as ConfigFile;

  if (!Array.isArray(parsed.watches)) {
    throw new Error(`config.json must have a "watches" array`);
  }

  return parsed;
}

// ─── loadConfig ───────────────────────────────────────────────────────────────

export function loadConfig(): AppConfig {
  const configFile = loadConfigFile();

  return {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseAnonKey: requireEnv("SUPABASE_PUBLISHABLE_KEY"),
    gmailUser: requireEnv("GMAIL_USER"),
    gmailAppPassword: requireEnv("GMAIL_APP_PASSWORD"),
    alertEmail: requireEnv("ALERT_EMAIL"),
    dryRun: process.env["DRY_RUN"] === "true",
    watches: configFile.watches,
  };
}
