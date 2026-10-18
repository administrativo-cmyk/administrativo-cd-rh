import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { DailyCallSnapshot } from "@/lib/daily-call-types";
import { mapDailyCallSnapshot } from "@/lib/data/daily-call-snapshot";

export interface DailyCallReadRepository {
  load(date: string, startDate: string, endDate: string): Promise<DailyCallSnapshot>;
}

export class SupabaseDailyCallRepository implements DailyCallReadRepository {
  async load(date: string, startDate: string, endDate: string): Promise<DailyCallSnapshot> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ler_chamada_diaria", {
      p_data: date, p_inicio: startDate, p_fim: endDate,
    });
    if (error) throw Object.assign(new Error("Não foi possível consultar a Chamada Diária."), { code: error.code });
    return { ...mapDailyCallSnapshot(data), loadedAt: new Date().toISOString() };
  }
}
