import { getUserTimezonePreference } from "@/lib/db/queries";
import { getRequestTimezone, normalizeTimezone } from "@/lib/utils/timezone";
import { pickEffectiveTimezone } from "./pick-effective-timezone";

export class InvalidScheduleTimezoneError extends Error {
  constructor(value: unknown) {
    super(`Invalid schedule timezone: ${String(value)}`);
    this.name = "InvalidScheduleTimezoneError";
  }
}

/**
 * Normalize a job/schedule-level timezone override.
 *
 * `undefined`, `null` and blank strings mean "no explicit override"; callers
 * should then fall back to the user's persisted preference. Any non-blank value
 * must be a valid IANA timezone because it will override the user preference.
 */
export function normalizeExplicitTimezone(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new InvalidScheduleTimezoneError(value);
  }

  if (value.trim().length === 0) return undefined;

  const normalized = normalizeTimezone(value);
  if (!normalized) {
    throw new InvalidScheduleTimezoneError(value);
  }
  return normalized;
}

/**
 * Query: resolve the timezone that should be used for a given user/request.
 *
 * Precedence: persisted user preference → browser-detected request header → UTC.
 * This is the single server-side seam every entry point should call instead of
 * reading the request header directly, so a saved preference always wins.
 */
export async function resolveUserTimezone(
  userId: string,
  request?: Request,
): Promise<string> {
  const preference = await getUserTimezonePreference(userId);
  const detected = request ? getRequestTimezone(request) : undefined;
  return pickEffectiveTimezone(preference.timezone, detected);
}

/**
 * Command/query helper for schedule creation/update entry points.
 *
 * A valid explicit timezone is a job-level override. When no explicit override
 * is present, the effective timezone comes from the user's persisted preference,
 * then the request's browser-detected timezone, then UTC.
 */
export async function resolveScheduleTimezone(input: {
  userId: string;
  request?: Request;
  explicitTimezone?: unknown;
}): Promise<string> {
  return (
    normalizeExplicitTimezone(input.explicitTimezone) ??
    (await resolveUserTimezone(input.userId, input.request))
  );
}
