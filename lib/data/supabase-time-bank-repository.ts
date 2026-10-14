import "server-only";

import { createClient } from "@/lib/supabase/server";
import { mapTimeBankSnapshot } from "@/lib/data/time-bank-snapshot";

export class SupabaseTimeBankRepository {
  async load(date: string) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ler_banco_horas_atual", { p_data: date });
    if (error) throw new Error(`Não foi possível consultar o Banco de Horas (${error.code}).`);
    return mapTimeBankSnapshot(data);
  }
}
