import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { DailyCallSnapshot } from "@/lib/daily-call-types";
import { mapDailyCallSnapshot } from "@/lib/data/daily-call-snapshot";

export interface DailyCallReadRepository {
  load(date: string, startDate: string, endDate: string, situation?: string): Promise<DailyCallSnapshot>;
}

export class SupabaseDailyCallRepository implements DailyCallReadRepository {
  async load(date: string, startDate: string, endDate: string, situation?: string): Promise<DailyCallSnapshot> {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("daily_call_read", {
      p_date: date, p_start: startDate, p_end: endDate, p_situation: situation || null,
    });
    if (error) throw Object.assign(new Error("Não foi possível consultar a Chamada Diária."), { code: error.code });
    return { ...mapDailyCallSnapshot(data), loadedAt: new Date().toISOString() };
  }
}
