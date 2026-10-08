import "server-only";

import { createClient } from "@/lib/supabase/server";
import { mapWorkforceSnapshot } from "@/lib/data/workforce-snapshot";

export class SupabaseWorkforceRepository {
  async load() {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ler_quadro_atual");
    if (error) throw new Error(`Não foi possível consultar o Quadro Atual (${error.code}).`);
    return mapWorkforceSnapshot(data);
  }
}
