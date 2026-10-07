import { computeNextRun } from "@/lib/cron/scheduler";

/**
 * Minimal shape of a scheduled job needed to re-align it with a new timezone.
 */
export interface TimezoneRecomputableJob {
  id: string;
  scheduleType: string | null;
  cronExpression: string | null;
  enabled: boolean;
}

/**
 * A computed change to apply to a single job when its owner switches timezone.
 * `nextRunAt` is present only when the next-run time must be rewritten (enabled
 * cron jobs); it is omitted for interval/once/disabled jobs whose next-run is
 * not timezone-sensitive, so callers leave that column untouched.
 */
export interface JobTimezoneUpdate {
  id: string;
  timezone: string;
  nextRunAt?: Date | null;
}

/**
 * Compute how each job's stored timezone and next-run should change when the
 * owning user switches to `timezone`.
 *
 * Why per-schedule-type:
 * - "cron" schedules interpret their expression in the configured timezone, so a
 *   timezone change moves the next fire time — recompute it.
 * - interval/once schedules fire at absolute instants independent of timezone, so
 *   only the stored timezone (used for execution-time display/context) changes.
 *
 * Pure: the only impurity is delegated to `computeNextRun`, with `now` injected.
 */
export function recomputeJobsForTimezone(
  jobs: TimezoneRecomputableJob[],
  timezone: string,
  now: Date = new Date(),
): JobTimezoneUpdate[] {
  return jobs.map((job) => {
    if (job.enabled && job.scheduleType === "cron" && job.cronExpression) {
      const nextRunAt = computeNextRun(
        { type: "cron", expression: job.cronExpression, timezone },
        now,
      );
      return { id: job.id, timezone, nextRunAt };
    }
    return { id: job.id, timezone };
  });
}
