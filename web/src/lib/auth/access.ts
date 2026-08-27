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
  registrationPending: boolean;
  staffLinkValid: boolean;
  storeActive: boolean;
  requiresRegistration: boolean;
  displayName: string;
  cessationDate: string | null;
  isCessationEffective: boolean;
  trainingEndDate: string | null;
  isTrainingEndEffective: boolean;
};

export const getCurrentAccess = cache(async (): Promise<CurrentAccess | null> => {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || !userId) return null;

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("id,email,first_name,last_name,role,status,store_id,staff_profile_id,registration_pending")
    .eq("id", userId)
    .single();
  if (profileError || !profile) return null;

  let cessationDate: string | null = null;
  let trainingEndDate: string | null = null;
  let isTrainee = false;
  let staffLinkValid = false;
  let storeActive = profile.role === "superadmin";
  if (profile.store_id) {
    const { data: store } = await supabase
      .from("stores")
      .select("is_active")
      .eq("id", profile.store_id)
      .maybeSingle();
    storeActive = Boolean(store?.is_active);
  }
  if (profile.staff_profile_id) {
    const { data: staff } = await supabase
      .from("staff_profiles")
      .select("id,user_id,store_id,cessation_date,is_trainee,training_end_date")
      .eq("id", profile.staff_profile_id)
      .maybeSingle();
    cessationDate = staff?.cessation_date ?? null;
    trainingEndDate = staff?.training_end_date ?? null;
    isTrainee = Boolean(staff?.is_trainee);
    staffLinkValid = Boolean(
      staff
      && staff.user_id === profile.id
      && staff.store_id === profile.store_id
    );
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const isStaffRole = profile.role === "collaborator" || profile.role === "trainer";
  const cessationEffective = isCessationEffective(cessationDate, today);
  const trainingEndEffective = isTrainee && isCessationEffective(trainingEndDate, today);
  const requiresRegistration = isStaffRole && (
    profile.status !== "active"
    || profile.registration_pending
    || !profile.staff_profile_id
    || !profile.store_id
    || !storeActive
    || !staffLinkValid
    || cessationEffective
    || trainingEndEffective
  );

  return {
    userId,
    email: profile.email,
    role: profile.role,
    status: profile.status,
    storeId: profile.store_id,
    staffProfileId: profile.staff_profile_id,
    registrationPending: profile.registration_pending,
    staffLinkValid,
    storeActive,
    requiresRegistration,
    displayName: [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email || "Usuario",
    cessationDate,
    isCessationEffective: cessationEffective,
    trainingEndDate,
    isTrainingEndEffective: trainingEndEffective,
  };
});
