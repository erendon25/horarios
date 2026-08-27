import { redirect } from "next/navigation";
import { getCurrentAccess } from "@/lib/auth/access";
import { routeForRole } from "@/lib/auth/access-rules";
export default async function PortalPage() {
  const access = await getCurrentAccess();
  if (!access) redirect("/login");
  if (access.requiresRegistration) redirect("/auth/logout?reason=registration");
  if (access.role === "admin" && !access.storeActive) redirect("/auth/logout?reason=inactive_store");
  if (access.status !== "active") redirect("/auth/logout?reason=inactive");
  if (access.isCessationEffective) redirect("/auth/logout?reason=cessation");
  redirect(routeForRole(access.role));
}
