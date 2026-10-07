import {
  applyTimezoneToUserJobs,
  getInheritedJobTimezone,
} from "@/lib/cron/service";
import { getUserTimezonePreference } from "@/lib/db/queries";
import { getRequestTimezone } from "@/lib/utils/timezone";

export interface ReconcileBrowserTimezoneResult {
  /** Whether the user currently follows the browser (no persisted preference). */
  followsBrowser: boolean;
  /** The detected browser timezone used for reconciliation, if any. */
  detectedTimezone: string | null;
  /** How many scheduled jobs were re-aligned (0 when already in sync). */
  realignedJobCount: number;
}

/**
 * Command: reconcile a follow-browser user's materialized job timezones with the
 * timezone reported by the current browser request.
 *
 * Why this use case exists: scheduled jobs store a *materialized* timezone, and
 * cron runs server-side with no browser. So for a user who follows the browser
 * (no persisted preference), the job snapshots can only be re-aligned while a
 * browser is present to report its timezone — there is no other moment the
 * effective timezone change is observable. The frontend calls this once on app
 * load; if the browser timezone has drifted from the jobs' stored timezone,
 * {@link applyTimezoneToUserJobs} re-aligns the user_preference jobs (and is a
 * no-op when nothing changed).
 *
 * Does nothing for users with an explicit persisted preference — their jobs are
 * owned by that preference, not by the browser. Pure orchestration: preference
 * read and job re-alignment are delegated to existing ports.
 */
export async function reconcileBrowserTimezone(input: {
  userId: string;
  request: Request;
  now?: Date;
}): Promise<ReconcileBrowserTimezoneResult> {
  const preference = await getUserTimezonePreference(input.userId);
  // Only follow-browser users (no persisted preference) need reconciliation.
  if (preference.timezone != null) {
    return {
      followsBrowser: false,
      detectedTimezone: null,
      realignedJobCount: 0,
    };
  }

  const detected = getRequestTimezone(input.request);
  if (!detected) {
    return {
      followsBrowser: true,
      detectedTimezone: null,
      realignedJobCount: 0,
    };
  }

  // The user's "previous effective timezone" is whatever their jobs are
  // currently aligned to. Passing it lets applyTimezoneToUserJobs re-align
  // legacy null-source jobs sitting at that timezone too (not just the
  // user_preference jobs) — important because timezone_source was added without
  // a backfill, so pre-existing jobs are all legacy null-source.
  const previousTimezone =
    (await getInheritedJobTimezone(input.userId)) ?? undefined;
  const realignedJobCount = await applyTimezoneToUserJobs(
    input.userId,
    detected,
    input.now ?? new Date(),
    undefined,
    previousTimezone,
  );
  return {
    followsBrowser: true,
    detectedTimezone: detected,
    realignedJobCount,
  };
}
