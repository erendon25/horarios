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

  const loadProfile = () => supabase
    .from("user_profiles")
    .select("id,email,first_name,last_name,role,status,store_id,staff_profile_id")
    .eq("id", userId)
    .maybeSingle();
  const loadCessationDate = async (staffProfileId: string | null) => {
    if (!staffProfileId) return null;
    const { data } = await supabase
      .from("staff_profiles")
      .select("cessation_date")
      .eq("id", staffProfileId)
      .maybeSingle();
    return data?.cessation_date ?? null;
  };

  const { data: profile, error: profileError } = await loadProfile();

  const cessationDate = await loadCessationDate(profile?.staff_profile_id ?? null);

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  if (profileError || !profile) return null;

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
