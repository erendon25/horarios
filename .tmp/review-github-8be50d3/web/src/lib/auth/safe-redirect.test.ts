import { describe, expect, it } from "vitest";
import { safeInternalRedirectPath } from "./safe-redirect";

describe("safeInternalRedirectPath", () => {
  it("allows internal paths including query and hash", () => {
    expect(safeInternalRedirectPath("/update-password?from=email#form")).toBe(
      "/update-password?from=email#form",
    );
  });

  it.each([
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%5c%5cevil.example",
  ])("falls back for unsafe target %s", (target) => {
    expect(safeInternalRedirectPath(target)).toBe("/portal");
  });
});
