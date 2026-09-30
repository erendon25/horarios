"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton({ userId }: { userId: string }) {
  const router = useRouter();
  async function logout() {
    sessionStorage.removeItem(`horarios-cache:${userId}`);
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return <button className="ghost-button" onClick={logout}><LogOut size={17} /> Salir</button>;
}
