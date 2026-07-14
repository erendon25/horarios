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

  const { data: caller, error: callerError } = await service
    .from("user_profiles")
    .select("role,status,store_id")
    .eq("id", authData.user.id)
    .single();
  if (callerError || !caller || caller.status !== "active" || !["admin", "superadmin"].includes(caller.role)) {
    return json(403, { error: "forbidden" });
  }

  const body = await request.json().catch(() => null);
  if (!body || body.operation !== "invite_staff" || typeof body.staffId !== "string") {
    return json(400, { error: "invalid_payload" });
  }

  const { data: staff, error: staffError } = await service
    .from("staff_profiles")
    .select("id,user_id,store_id,email,first_name,last_name,position,status")
    .eq("id", body.staffId)
    .single();
  if (staffError || !staff) return json(404, { error: "staff_not_found" });
  if (caller.role === "admin" && (!caller.store_id || caller.store_id !== staff.store_id)) {
    return json(403, { error: "different_store" });
  }
  if (staff.user_id) return json(409, { error: "already_linked" });
  if (staff.status === "inactive") return json(409, { error: "inactive_staff" });

  const email = staff.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: "staff_email_required" });
  }

  const invitedRole = staff.position?.trim().toUpperCase() === "ENTRENADOR" ? "trainer" : "collaborator";
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

  return json(200, { invited: true, email, role: invitedRole });
});
