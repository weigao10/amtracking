/**
 * EmailNotifier — INotifier implementation using Gmail via nodemailer.
 *
 * Requires a Gmail account with an App Password (2-step verification must be
 * enabled on the account). Set GMAIL_USER, GMAIL_APP_PASSWORD, and ALERT_EMAIL
 * environment variables before running.
 */

import nodemailer, { Transporter } from "nodemailer";
import { AlertPayload, INotifier } from "./interface";

// ─── Message formatters ───────────────────────────────────────────────────────

function formatSubject(payload: AlertPayload): string {
  const { alertType, route, dateLabel, currentPrice } = payload;

  switch (alertType) {
    case "below_target":
      return `[Amtracking] Price alert: ${route} on ${dateLabel} — $${currentPrice}`;
    case "price_drop":
      return `[Amtracking] Price dropped: ${route} on ${dateLabel} — $${currentPrice}`;
    case "near_historic_low":
      return `[Amtracking] Near historic low: ${route} on ${dateLabel} — $${currentPrice}`;
  }
}

/**
 * Build the short one-liner body matching the spec:
 *
 * below_target:      "NYC → DC on Jun 15 dropped to $72 (your target: $89)"
 * price_drop:        "NYC → DC on Jun 15 dropped $15 → $84 (was $99)"
 * near_historic_low: "NYC → DC on Jun 15 is $84 — near its historic low of $79 (6% above)"
 */
function formatBody(payload: AlertPayload): string {
  const { alertType, route, dateLabel, currentPrice, targetPrice, previousPrice, historicLow } =
    payload;

  switch (alertType) {
    case "below_target": {
      const target = targetPrice !== undefined ? `$${targetPrice}` : "your target";
      return (
        `${route} on ${dateLabel} dropped to $${currentPrice} (your target: ${target})\n\n` +
        `Book now: https://www.amtrak.com/`
      );
    }

    case "price_drop": {
      const drop =
        previousPrice !== undefined
          ? `$${previousPrice - currentPrice} → $${currentPrice} (was $${previousPrice})`
          : `to $${currentPrice}`;
      return (
        `${route} on ${dateLabel} dropped ${drop}\n\n` +
        `Book now: https://www.amtrak.com/`
      );
    }

    case "near_historic_low": {
      if (historicLow !== undefined && historicLow > 0) {
        const pctAbove = Math.round(((currentPrice - historicLow) / historicLow) * 100);
        return (
          `${route} on ${dateLabel} is $${currentPrice} — ` +
          `near its historic low of $${historicLow} (${pctAbove}% above)\n\n` +
          `Book now: https://www.amtrak.com/`
        );
      }
      return (
        `${route} on ${dateLabel} is $${currentPrice} — near its historic low\n\n` +
        `Book now: https://www.amtrak.com/`
      );
    }
  }
}

function formatHtmlBody(payload: AlertPayload): string {
  const text = formatBody(payload);
  const lines = text.split("\n").map((l) => `<p>${l}</p>`).join("");
  return `<html><body style="font-family:sans-serif;">${lines}</body></html>`;
}

// ─── EmailNotifier ────────────────────────────────────────────────────────────

export interface EmailNotifierConfig {
  /** Gmail address used as the sender, e.g. "bot@gmail.com" */
  gmailUser: string;
  /** 16-character Gmail App Password */
  gmailAppPassword: string;
  /** Destination email address for alerts */
  alertEmail: string;
}

export class EmailNotifier implements INotifier {
  private readonly transporter: Transporter;
  private readonly config: EmailNotifierConfig;

  constructor(config: EmailNotifierConfig) {
    this.config = config;
    this.transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: config.gmailUser,
        pass: config.gmailAppPassword,
      },
    });
  }

  async sendAlert(payload: AlertPayload): Promise<void> {
    const subject = formatSubject(payload);
    const text = formatBody(payload);
    const html = formatHtmlBody(payload);

    await this.transporter.sendMail({
      from: `"Amtracking" <${this.config.gmailUser}>`,
      to: this.config.alertEmail,
      subject,
      text,
      html,
    });

    console.log(`[EmailNotifier] Sent "${subject}" to ${this.config.alertEmail}`);
  }
}
