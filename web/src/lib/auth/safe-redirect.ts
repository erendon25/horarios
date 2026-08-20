const FALLBACK_PATH = "/portal";

export function safeInternalRedirectPath(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /%(?:2f|5c)/i.test(value)
  ) {
    return FALLBACK_PATH;
  }

  try {
    const parsed = new URL(value, "https://local.invalid");
    return parsed.origin === "https://local.invalid"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : FALLBACK_PATH;
  } catch {
    return FALLBACK_PATH;
  }
}
