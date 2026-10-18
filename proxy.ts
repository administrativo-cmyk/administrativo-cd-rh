import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { AuthenticatedProfile } from "@/lib/auth/types";
import { routeRedirectForAccess } from "@/lib/auth/route-access";
import { redirectWithSession, refreshSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // APIs enforce their own session/role or scoped worker-token contract and return HTTP errors.
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  const { supabase, response, userId, cookieUpdates, cacheHeaders } = await refreshSupabaseSession(request);
  let profile: Pick<AuthenticatedProfile, "status_usuario" | "papel_usuario"> | null = null;

  if (userId) {
    const { data: rawProfile } = await supabase
      .from("perfis")
      .select("status_usuario,papel_usuario")
      .eq("id", userId)
      .single();
    profile = rawProfile as Pick<AuthenticatedProfile, "status_usuario" | "papel_usuario"> | null;
  }

  const destination = routeRedirectForAccess(
    request.nextUrl.pathname,
    profile ? { status: profile.status_usuario, role: profile.papel_usuario } : null,
  );

  return destination
    ? redirectWithSession(request, destination, cookieUpdates, cacheHeaders)
    : response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|media/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)",
  ],
};
