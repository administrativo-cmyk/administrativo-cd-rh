import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

type CookieUpdate = { name: string; value: string; options: CookieOptions };

export async function refreshSupabaseSession(request: NextRequest) {
  const { url, publishableKey } = getSupabasePublicConfig();
  const cookieUpdates: CookieUpdate[] = [];
  const cacheHeaders = new Headers();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        cookieUpdates.splice(0, cookieUpdates.length, ...cookiesToSet);
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headersToSet ?? {}).forEach(([name, value]) => {
          cacheHeaders.set(name, value);
          response.headers.set(name, value);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const userId = error ? null : typeof data?.claims?.sub === "string" ? data.claims.sub : null;

  return { supabase, response, userId, cookieUpdates, cacheHeaders };
}

export function redirectWithSession(
  request: NextRequest,
  destination: string,
  cookieUpdates: CookieUpdate[],
  cacheHeaders: Headers,
) {
  const response = NextResponse.redirect(new URL(destination, request.url));
  cookieUpdates.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  cacheHeaders.forEach((value, name) => response.headers.set(name, value));
  return response;
}
