import { describe, expect, it } from "vitest";
import { isCessationEffective, routeForRole } from "./access-rules";

describe("reglas de acceso migradas", () => {
  it("mantiene acceso durante el mismo día del cese", () => expect(isCessationEffective("2026-07-12", "2026-07-12")).toBe(false));
  it("revoca acceso desde el día posterior", () => expect(isCessationEffective("2026-07-12", "2026-07-13")).toBe(true));
  it("restaura acceso al quitar la fecha", () => expect(isCessationEffective(null, "2026-07-13")).toBe(false));
  it("enruta todos los roles sin atajos por correo", () => {
    expect(routeForRole("superadmin")).toBe("/superadmin"); expect(routeForRole("admin")).toBe("/admin");
    expect(routeForRole("trainer")).toBe("/training"); expect(routeForRole("collaborator")).toBe("/staff");
  });
});
