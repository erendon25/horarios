import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isCessationEffective, type AppRole } from "@/lib/auth/access-rules";

export type CurrentAccess = {
  userId: string;
  email: string | null;
  role: AppRole;
  status: "pending" | "active" | "inactive";
  storeId: string | null;
  staffProfileId: string | null;
  displayName: string;
  cessationDate: string | null;
  isCessationEffective: boolean;
};

export const getCurrentAccess = cache(async (): Promise<CurrentAccess | null> => {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return null;

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("id,email,first_name,last_name,role,status,store_id,staff_profile_id")
    .eq("id", userId)
    .single();
  if (profileError || !profile) return null;

  let cessationDate: string | null = null;
  if (profile.staff_profile_id) {
    const { data: staff } = await supabase
      .from("staff_profiles")
      .select("cessation_date")
      .eq("id", profile.staff_profile_id)
      .maybeSingle();
    cessationDate = staff?.cessation_date ?? null;
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return {
    userId,
    email: profile.email,
    role: profile.role,
    status: profile.status,
    storeId: profile.store_id,
    staffProfileId: profile.staff_profile_id,
    displayName: [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email || "Usuario",
    cessationDate,
    isCessationEffective: isCessationEffective(cessationDate, today),
  };
});
