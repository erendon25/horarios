export type AppRole = "superadmin" | "admin" | "trainer" | "collaborator";

export function isCessationEffective(cessationDate: string | null, today: string) {
  return Boolean(cessationDate && today > cessationDate.slice(0, 10));
}

export function routeForRole(role: AppRole) {
  if (role === "superadmin") return "/superadmin";
  if (role === "admin") return "/admin";
  if (role === "trainer") return "/training";
  return "/staff";
}
