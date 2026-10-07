import { isValidTimezone } from "@/lib/utils/timezone";

import { type HourCycle, resolveHourCycle } from "./constants";

/**
 * Live "UTC±HH:MM" offset label for a timezone at a given instant.
 * Returns "" for invalid timezones. Recomputed per call so DST is reflected.
 */
export function getTimezoneOffsetLabel(
  timezone: string,
  at: Date = new Date(),
): string {
  if (!isValidTimezone(timezone)) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    }).formatToParts(at);
    const name =
      parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    // Intl yields "GMT+08:00" / "GMT" — normalize the prefix to UTC.
    return name.replace("GMT", "UTC") || "UTC";
  } catch {
    return "";
  }
}

/**
 * Human city label derived from an IANA id, e.g. "America/Argentina/Buenos_Aires"
 * → "Buenos Aires", "UTC" → "UTC".
 */
export function getTimezoneCityLabel(timezone: string): string {
  if (!timezone) return "";
  const segment = timezone.split("/").pop() ?? timezone;
  return segment.replace(/_/g, " ");
}

/**
 * "Buenos Aires (UTC-03:00)" style label for a picker option.
 */
export function getTimezoneDisplayLabel(
  timezone: string,
  at: Date = new Date(),
): string {
  const city = getTimezoneCityLabel(timezone);
  const offset = getTimezoneOffsetLabel(timezone, at);
  if (!offset) return city || timezone;
  if (city === "UTC") return city;
  return `${city} (${offset})`;
}

/**
 * Render only the time-of-day (e.g. "18:00" or "6:00 PM") for an instant as seen
 * in `timezone`. Used for the "runs at HH:MM in <tz>" schedule hint.
 */
export function formatTimeInTimezone(
  date: Date,
  timezone: string,
  hourCycle: HourCycle | null = null,
  locale = "en-US",
): string {
  const tz = isValidTimezone(timezone) ? timezone : "UTC";
  // null follows the locale default (e.g. 12-hour for en-US) instead of forcing
  // 24-hour. Use a numeric hour for 12-hour clocks ("6:00 PM") and a 2-digit
  // hour for 24-hour clocks ("18:00"), matching formatTaskLastExecutionTime.
  const cycle = resolveHourCycle(hourCycle, locale);
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: cycle === "h12" ? "numeric" : "2-digit",
      minute: "2-digit",
      hourCycle: cycle,
    }).format(date);
  } catch {
    return "";
  }
}
