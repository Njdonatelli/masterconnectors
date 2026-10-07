const USER_TIMEZONE_HEADER = "x-user-timezone";

export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;

  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(value: unknown): string | undefined {
  // Normalize whitespace BEFORE validating: a value like " Asia/Tokyo " is a
  // valid zone once trimmed, and the function's contract is to return the
  // normalized id. Validating the raw value would reject it as invalid.
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return isValidTimezone(trimmed) ? trimmed : undefined;
}

export function getResolvedUserTimezone(): string {
  if (
    typeof Intl === "undefined" ||
    typeof Intl.DateTimeFormat !== "function"
  ) {
    return "UTC";
  }

  try {
    return (
      normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone) ??
      "UTC"
    );
  } catch {
    return "UTC";
  }
}

export function getUserTimezoneHeaders(): Record<string, string> {
  return { [USER_TIMEZONE_HEADER]: getResolvedUserTimezone() };
}

export function getRequestTimezone(request: Request): string | undefined {
  return normalizeTimezone(request.headers.get(USER_TIMEZONE_HEADER));
}
