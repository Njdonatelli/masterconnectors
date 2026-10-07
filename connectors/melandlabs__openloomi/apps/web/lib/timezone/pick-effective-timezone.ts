import { normalizeTimezone } from "@/lib/utils/timezone";

/**
 * Resolve the effective timezone from the available sources, in priority order:
 *   1. The user's persisted preference (`persisted`).
 *   2. The browser-detected timezone (`detected`, e.g. the x-user-timezone header).
 *   3. `fallback` ("UTC" by default).
 *
 * Invalid IANA strings at any level are skipped so a bad value never wins over a
 * valid lower-priority source. Pure and dependency-free — safe to unit test.
 */
export function pickEffectiveTimezone(
  persisted: string | null | undefined,
  detected: string | null | undefined,
  fallback = "UTC",
): string {
  return (
    normalizeTimezone(persisted) ?? normalizeTimezone(detected) ?? fallback
  );
}
