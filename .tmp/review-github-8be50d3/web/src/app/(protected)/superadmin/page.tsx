import { redirect } from "next/navigation";
import { SuperadminOverview } from "@/components/superadmin-overview";
import { getCurrentAccess } from "@/lib/auth/access";
export default async function SuperadminPage() { const access = await getCurrentAccess(); if (access?.role !== "superadmin") redirect("/portal"); return <main className="content"><SuperadminOverview /></main>; }
