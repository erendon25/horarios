import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const url = new URL("/login", request.url);
  const reason = request.nextUrl.searchParams.get("reason");
  if (["cessation", "inactive", "inactive_store", "registration"].includes(reason ?? "")) {
    url.searchParams.set("reason", reason!);
  }
  return NextResponse.redirect(url);
}
