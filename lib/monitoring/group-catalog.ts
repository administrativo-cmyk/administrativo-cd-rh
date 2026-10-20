import { z } from "zod";

export const groupCatalogSchema = z.object({ groups: z.array(z.string().min(1)), queriedAt: z.string() });
export type GroupCatalog = z.infer<typeof groupCatalogSchema>;
