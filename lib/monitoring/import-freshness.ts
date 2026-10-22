import { z } from "zod";

export const importFreshnessSchema = z.object({
  sourceId: z.string().min(1).max(80),
  name: z.string().min(1),
  kind: z.enum(["afd", "defense-access"]),
  lastImportAt: z.string().datetime({ offset: true }).nullable(),
  lastRecordAt: z.string().datetime({ offset: true }).nullable(),
});
export type ImportFreshness = z.infer<typeof importFreshnessSchema>;
