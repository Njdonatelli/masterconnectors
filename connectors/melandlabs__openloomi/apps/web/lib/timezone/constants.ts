/**
 * Timezone domain constants shared across the timezone use cases and UI.
 */

/**
 * Hour cycle preference for time display.
 * - "h12": 12-hour clock (e.g. 6:00 PM)
 * - "h23": 24-hour clock (e.g. 18:00)
 */
export const HOUR_CYCLES = ["h12", "h23"] as const;

export type HourCycle = (typeof HOUR_CYCLES)[number];

export const DEFAULT_HOUR_CYCLE: HourCycle = "h23";

export function isHourCycle(value: unknown): value is HourCycle {
  return value === "h12" || value === "h23";
}

/**
 * Resolve a stored hour-cycle preference to a concrete clock for rendering.
 *
 * This is the single rule every time formatter must use, so the meaning of a
 * missing preference is defined in exactly one place.
 *
 * - An explicit "h12"/"h23" always wins.
 * - `null`/`undefined` means "no preference": follow the display locale's own
 *   default — `h12` for en-US (the primary market) and other 12-hour locales,
 *   `h23` for zh-Hans / en-GB / ja-JP / etc. This honors the documented
 *   "null = follow locale default" contract instead of forcing 24-hour on users
 *   who never chose it.
 */
export function resolveHourCycle(
  preference: HourCycle | null | undefined,
  locale: string,
): HourCycle {
  if (preference === "h12" || preference === "h23") return preference;
  try {
    const resolved = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
    }).resolvedOptions().hourCycle;
    return resolved === "h11" || resolved === "h12" ? "h12" : "h23";
  } catch {
    return DEFAULT_HOUR_CYCLE;
  }
}

/**
 * Curated list of major IANA timezones offered in the settings picker.
 * Users are not limited to this list at the data layer (any valid IANA string
 * is accepted), but the UI surfaces these common choices grouped by region.
 *
 * `labelKey` maps to an i18n key under `settings.timezones`; the live UTC offset
 * is computed at render time so the list never goes stale across DST changes.
 */
export interface TimezoneOption {
  /** IANA timezone identifier, e.g. "Asia/Shanghai". */
  value: string;
  /** Region grouping used to render <optgroup>-style sections. */
  region: TimezoneRegion;
}

export type TimezoneRegion =
  | "general"
  | "americas"
  | "europe"
  | "africa"
  | "asia"
  | "oceania";

export const SUPPORTED_TIMEZONES: readonly TimezoneOption[] = [
  { value: "UTC", region: "general" },

  // Americas
  { value: "America/Los_Angeles", region: "americas" },
  { value: "America/Denver", region: "americas" },
  { value: "America/Chicago", region: "americas" },
  { value: "America/New_York", region: "americas" },
  { value: "America/Toronto", region: "americas" },
  { value: "America/Mexico_City", region: "americas" },
  { value: "America/Bogota", region: "americas" },
  { value: "America/Sao_Paulo", region: "americas" },
  { value: "America/Argentina/Buenos_Aires", region: "americas" },

  // Europe
  { value: "Europe/London", region: "europe" },
  { value: "Europe/Paris", region: "europe" },
  { value: "Europe/Berlin", region: "europe" },
  { value: "Europe/Madrid", region: "europe" },
  { value: "Europe/Rome", region: "europe" },
  { value: "Europe/Athens", region: "europe" },
  { value: "Europe/Moscow", region: "europe" },

  // Africa
  { value: "Africa/Lagos", region: "africa" },
  { value: "Africa/Cairo", region: "africa" },
  { value: "Africa/Johannesburg", region: "africa" },

  // Asia
  { value: "Asia/Dubai", region: "asia" },
  { value: "Asia/Karachi", region: "asia" },
  { value: "Asia/Kolkata", region: "asia" },
  { value: "Asia/Bangkok", region: "asia" },
  { value: "Asia/Jakarta", region: "asia" },
  { value: "Asia/Shanghai", region: "asia" },
  { value: "Asia/Hong_Kong", region: "asia" },
  { value: "Asia/Singapore", region: "asia" },
  { value: "Asia/Taipei", region: "asia" },
  { value: "Asia/Seoul", region: "asia" },
  { value: "Asia/Tokyo", region: "asia" },

  // Oceania
  { value: "Australia/Perth", region: "oceania" },
  { value: "Australia/Sydney", region: "oceania" },
  { value: "Pacific/Auckland", region: "oceania" },
] as const;
