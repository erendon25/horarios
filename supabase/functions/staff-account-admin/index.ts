import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const normalizeEmail = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const roleForPosition = (position: unknown) =>
  typeof position === "string" && position.trim().toUpperCase() === "ENTRENADOR" ? "trainer" : "collaborator";
const limaToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const staffEpisodeEnded = (staff: { cessation_date?: string | null; is_trainee?: boolean | null; training_end_date?: string | null }) => {
  const today = limaToday();
  return Boolean(
    (staff.cessation_date && staff.cessation_date < today)
    || (staff.is_trainee && staff.training_end_date && staff.training_end_date < today)
  );
};

type ServiceClient = ReturnType<typeof createClient>;
type StaffAccount = {
  id: string;
  user_id: string | null;
  store_id: string;
  email: string | null;
  first_name: string;
  last_name: string;
  position: string;
  status: string;
  cessation_date: string | null;
  is_trainee: boolean;
  training_end_date: string | null;
};

async function consumeRateLimit(
  service: ServiceClient,
  userId: string,
  scope: string,
  maxRequests: number,
) {
  const { data, error } = await service.rpc("consume_rate_limit", {
    p_bucket_key: `staff-account-admin:${scope}:${userId}`,
    p_max_requests: maxRequests,
    p_window_seconds: 900,
  });
  if (error) return { error: json(503, { error: "rate_limit_unavailable" }) };
  const limit = data?.[0];
  if (!limit?.allowed) {
    return {
      error: new Response(JSON.stringify({ error: "rate_limited", retryAfter: limit?.retry_after_seconds ?? 900 }), {
        status: 429,
        headers: {
          ...corsHeaders,
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "retry-after": String(limit?.retry_after_seconds ?? 900),
        },
      }),
    };
  }
  return { error: null };
}

async function registrationAccess(service: ServiceClient, userId: string) {
  const { data: profile, error } = await service
    .from("user_profiles")
    .select("role,status,store_id,staff_profile_id,registration_pending")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { allowed: false, error: "registration_access_failed" as const };
  if (!profile) return { allowed: true, error: null };
  if (["admin", "superadmin"].includes(profile.role)) {
    return { allowed: false, error: "administrative_account" as const };
  }
  if (profile.status !== "active" || profile.registration_pending || !profile.staff_profile_id || !profile.store_id) {
    return { allowed: true, error: null };
  }

  const { data: staff, error: staffError } = await service
    .from("staff_profiles")
    .select("user_id,store_id,cessation_date,is_trainee,training_end_date")
    .eq("id", profile.staff_profile_id)
    .maybeSingle();
  if (staffError) return { allowed: false, error: "registration_access_failed" as const };
  if (!staff || staff.user_id !== userId || staff.store_id !== profile.store_id) {
    return { allowed: true, error: null };
  }
  const { data: store, error: storeError } = await service
    .from("stores")
    .select("is_active")
    .eq("id", staff.store_id)
    .maybeSingle();
  if (storeError) return { allowed: false, error: "registration_access_failed" as const };
  if (!store?.is_active) return { allowed: true, error: null };
  const episodeEnded = staffEpisodeEnded(staff);
  return { allowed: episodeEnded, error: episodeEnded ? null : "account_already_linked" as const };
}

async function recoverExistingStaffLink(service: ServiceClient, userId: string) {
  const { data: profile, error: profileError } = await service
    .from("user_profiles")
    .select("id,role,status,store_id,staff_profile_id,registration_pending")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) return { error: "registration_access_failed" as const, linked: false };
  if (!profile || !["collaborator", "trainer"].includes(profile.role) || !profile.staff_profile_id) {
    return { error: null, linked: false };
  }

  const { data: staff, error: staffError } = await service
    .from("staff_profiles")
    .select("id,user_id,store_id,cessation_date,is_trainee,training_end_date")
    .eq("id", profile.staff_profile_id)
    .maybeSingle();
  if (staffError) return { error: "registration_access_failed" as const, linked: false };
  if (!staff || staff.user_id !== userId || staff.store_id !== profile.store_id) {
    return { error: null, linked: false };
  }
  if (!['active', 'pending'].includes(profile.status)) return { error: "inactive_account" as const, linked: true };
  if (staff.cessation_date && staff.cessation_date < limaToday()) {
    return { error: "employment_ended" as const, linked: true };
  }
  if (staff.is_trainee && staff.training_end_date && staff.training_end_date < limaToday()) {
    return { error: "training_ended" as const, linked: true };
  }

  const { data: store, error: storeError } = await service
    .from("stores")
    .select("is_active")
    .eq("id", staff.store_id)
    .maybeSingle();
  if (storeError) return { error: "registration_access_failed" as const, linked: true };
  if (!store?.is_active) return { error: "inactive_store" as const, linked: true };

  if (profile.registration_pending || profile.status === "pending") {
    const { error: repairError } = await service
      .from("user_profiles")
      .update({ status: "active", registration_pending: false, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .eq("staff_profile_id", staff.id)
      .eq("store_id", staff.store_id);
    if (repairError) return { error: "link_repair_failed" as const, linked: true };
  }
  return { error: null, linked: true };
}

const eligibleStaffQuery = (service: ServiceClient) => service
  .from("staff_profiles")
  .select("id,store_id,email,first_name,last_name,position,status,cessation_date,is_trainee,training_end_date")
  .eq("status", "pending")
  .is("user_id", null)
  .or(`cessation_date.is.null,cessation_date.gte.${limaToday()}`);

async function listRegistrationStores(service: ServiceClient) {
  const { data: staff, error } = await eligibleStaffQuery(service);
  if (error) return { error: "staff_lookup_failed" as const, stores: [] };
  const storeIds = [...new Set((staff ?? [])
    .filter((row) => !staffEpisodeEnded(row))
    .map((row) => row.store_id))];
  if (storeIds.length === 0) return { error: null, stores: [] };

  const { data: stores, error: storesError } = await service
    .from("stores")
    .select("id,name")
    .in("id", storeIds)
    .eq("is_active", true)
    .order("name");
  if (storesError) return { error: "store_lookup_failed" as const, stores: [] };
  return { error: null, stores: stores ?? [] };
}

async function listRegistrationStaff(service: ServiceClient, storeId: string) {
  const { data: store, error: storeError } = await service
    .from("stores")
    .select("id")
    .eq("id", storeId)
    .eq("is_active", true)
    .maybeSingle();
  if (storeError) return { error: "store_lookup_failed" as const, staff: [] };
  if (!store) return { error: null, staff: [] };

  const { data, error } = await eligibleStaffQuery(service)
    .eq("store_id", storeId)
    .order("first_name")
    .order("last_name");
  if (error) return { error: "staff_lookup_failed" as const, staff: [] };
  return {
    error: null,
    staff: (data ?? [])
      .filter((row) => !staffEpisodeEnded(row))
      .map(({ id, first_name, last_name, position }) => ({ id, first_name, last_name, position })),
  };
}

async function findExistingUserId(service: ServiceClient, email: string) {
  const [staffResult, profileResult] = await Promise.all([
    service.from("staff_profiles").select("user_id,email").ilike("email", email).not("user_id", "is", null),
    service.from("user_profiles").select("id,email").ilike("email", email),
  ]);
  if (staffResult.error || profileResult.error) return { error: "account_lookup_failed" as const, userId: null };

  const ids = new Set<string>();
  for (const row of staffResult.data ?? []) {
    if (normalizeEmail(row.email) === email && row.user_id) ids.add(row.user_id);
  }
  for (const row of profileResult.data ?? []) {
    if (normalizeEmail(row.email) === email && row.id) ids.add(row.id);
  }
  if (ids.size === 0) return { error: null, userId: null };
  if (ids.size > 1) return { error: "ambiguous_existing_account" as const, userId: null };
  return { error: null, userId: [...ids][0] };
}

async function linkExistingAccount(
  service: ServiceClient,
  staff: StaffAccount,
  userId: string,
  email: string,
) {
  const role = roleForPosition(staff.position);
  const { data: previousStaffId, error } = await service.rpc("link_existing_staff_account", {
    p_staff_id: staff.id,
    p_user_id: userId,
    p_email: email,
    p_role: role,
  });
  if (error) return { error: "rehire_link_failed" as const };

  // La autorización de la app usa user_profiles. app_metadata se mantiene
  // sincronizado como dato auxiliar, pero un fallo aquí no revierte el vínculo.
  const metadata = await service.auth.admin.updateUserById(userId, {
    app_metadata: { role, store_id: staff.store_id },
  });
  return {
    error: null,
    role,
    previousStaffId: previousStaffId ?? null,
    metadataUpdated: !metadata.error,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "missing_server_configuration" });

  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!accessToken) return json(401, { error: "missing_session" });

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await service.auth.getUser(accessToken);
  if (authError || !authData.user) return json(401, { error: "invalid_session" });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.operation !== "string") return json(400, { error: "invalid_payload" });

  if (body.operation === "recover_existing_staff_link") {
    const limit = await consumeRateLimit(service, authData.user.id, "registration-recovery", 30);
    if (limit.error) return limit.error;
    const recovery = await recoverExistingStaffLink(service, authData.user.id);
    if (recovery.error) {
      const denied = ["inactive_account", "employment_ended", "training_ended", "inactive_store"].includes(recovery.error);
      return json(denied ? 409 : 500, { error: recovery.error, linked: recovery.linked });
    }
    return json(200, { linked: recovery.linked, recovered: recovery.linked });
  }

  if (["list_registration_stores", "list_registration_staff", "claim_staff_account"].includes(body.operation)) {
    const email = normalizeEmail(authData.user.email);
    if (!email) return json(400, { error: "account_email_required" });
    if (!authData.user.email_confirmed_at) return json(403, { error: "email_not_confirmed" });

    const access = await registrationAccess(service, authData.user.id);
    if (!access.allowed) {
      return json(access.error === "account_already_linked" ? 409 : 403, { error: access.error });
    }

    const isClaim = body.operation === "claim_staff_account";
    const limit = await consumeRateLimit(service, authData.user.id, isClaim ? "registration-claim" : "registration-list", isClaim ? 5 : 30);
    if (limit.error) return limit.error;

    if (body.operation === "list_registration_stores") {
      const result = await listRegistrationStores(service);
      return result.error ? json(500, { error: result.error }) : json(200, { stores: result.stores });
    }

    if (body.operation === "list_registration_staff") {
      if (typeof body.storeId !== "string") return json(400, { error: "store_required" });
      const result = await listRegistrationStaff(service, body.storeId);
      return result.error ? json(500, { error: result.error }) : json(200, { staff: result.staff });
    }

    if (typeof body.staffId !== "string" || typeof body.dni !== "string") {
      return json(400, { error: "staff_and_dni_required" });
    }
    const normalizedDni = body.dni.replace(/\D/g, "");
    if (normalizedDni.length < 6 || normalizedDni.length > 15) {
      return json(400, { error: "invalid_dni" });
    }

    const { data: staff, error: staffError } = await eligibleStaffQuery(service)
      .eq("id", body.staffId)
      .maybeSingle();
    if (staffError || !staff || staffEpisodeEnded(staff)) {
      return json(409, { error: "staff_not_available" });
    }

    const { data: previousStaffId, error: claimError } = await service.rpc("claim_staff_account", {
      p_staff_id: staff.id,
      p_user_id: authData.user.id,
      p_email: email,
      p_dni: normalizedDni,
    });
    if (claimError) {
      const mismatch = claimError.message.toLowerCase().includes("dni");
      return json(mismatch ? 403 : 409, { error: mismatch ? "identity_mismatch" : "claim_failed" });
    }

    const role = roleForPosition(staff.position);
    const metadata = await service.auth.admin.updateUserById(authData.user.id, {
      app_metadata: { role, store_id: staff.store_id },
    });
    return json(200, {
      linked: true,
      reactivated: Boolean(previousStaffId),
      staffId: staff.id,
      previousStaffId: previousStaffId ?? null,
      role,
      metadataUpdated: !metadata.error,
    });
  }

  if (body.operation !== "invite_staff" || typeof body.staffId !== "string") {
    return json(400, { error: "invalid_payload" });
  }

  const { data: caller, error: callerError } = await service
    .from("user_profiles")
    .select("role,status,store_id")
    .eq("id", authData.user.id)
    .single();
  if (callerError || !caller || caller.status !== "active" || !["admin", "superadmin"].includes(caller.role)) {
    return json(403, { error: "forbidden" });
  }
  if (caller.role === "admin") {
    if (!caller.store_id) return json(403, { error: "inactive_store" });
    const { data: callerStore, error: callerStoreError } = await service
      .from("stores")
      .select("is_active")
      .eq("id", caller.store_id)
      .maybeSingle();
    if (callerStoreError || !callerStore?.is_active) return json(403, { error: "inactive_store" });
  }

  const limit = await consumeRateLimit(service, authData.user.id, "admin-invite", 5);
  if (limit.error) return limit.error;

  const { data: staff, error: staffError } = await service
    .from("staff_profiles")
    .select("id,user_id,store_id,email,first_name,last_name,position,status,cessation_date,is_trainee,training_end_date")
    .eq("id", body.staffId)
    .single();
  if (staffError || !staff) return json(404, { error: "staff_not_found" });
  if (caller.role === "admin" && (!caller.store_id || caller.store_id !== staff.store_id)) {
    return json(403, { error: "different_store" });
  }
  if (staff.user_id) return json(409, { error: "already_linked" });
  if (staff.status === "inactive" || staffEpisodeEnded(staff)) {
    return json(409, { error: "inactive_staff" });
  }

  const email = normalizeEmail(staff.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: "staff_email_required" });
  }

  const existing = await findExistingUserId(service, email);
  if (existing.error) return json(409, { error: existing.error });
  if (existing.userId) {
    const linked = await linkExistingAccount(service, staff as StaffAccount, existing.userId, email);
    if (linked.error) return json(409, { error: linked.error });
    return json(200, {
      invited: false,
      reactivated: true,
      email,
      role: linked.role,
      previousStaffId: linked.previousStaffId,
      metadataUpdated: linked.metadataUpdated,
    });
  }

  const invitedRole = roleForPosition(staff.position);
  const appUrl = Deno.env.get("APP_URL")?.replace(/\/$/, "");
  if (!appUrl) return json(503, { error: "app_url_not_configured" });
  const redirectTo = `${appUrl}/update-password`;
  const { data: invitation, error: invitationError } = await service.auth.admin.inviteUserByEmail(email, {
    data: { first_name: staff.first_name, last_name: staff.last_name },
    redirectTo,
  });
  if (invitationError || !invitation.user) {
    const duplicate = invitationError?.message.toLowerCase().includes("already") ?? false;
    return json(duplicate ? 409 : 400, { error: duplicate ? "email_already_registered" : "invite_failed" });
  }

  const invitedUserId = invitation.user.id;
  const metadataUpdate = await service.auth.admin.updateUserById(invitedUserId, {
    app_metadata: { role: invitedRole, store_id: staff.store_id },
  });
  if (metadataUpdate.error) {
    await service.auth.admin.deleteUser(invitedUserId);
    return json(500, { error: "metadata_update_failed" });
  }

  const { error: linkError } = await service.rpc("link_invited_staff_account", {
    p_staff_id: staff.id,
    p_user_id: invitedUserId,
    p_email: email,
    p_role: invitedRole,
  });
  if (linkError) {
    await service.auth.admin.deleteUser(invitedUserId);
    return json(409, { error: "link_failed" });
  }

  return json(200, { invited: true, reactivated: false, email, role: invitedRole });
});
