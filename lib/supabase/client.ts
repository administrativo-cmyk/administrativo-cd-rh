import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/persistence/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient<Database> | undefined;

export function createClient() {
  if (!browserClient) {
    const { url, publishableKey } = getSupabasePublicConfig();
    browserClient = createBrowserClient<Database>(url, publishableKey);
  }

  return browserClient;
}
