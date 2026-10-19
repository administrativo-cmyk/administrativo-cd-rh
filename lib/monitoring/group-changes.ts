import { z } from "zod";

export const groupChangeFiltersSchema=z.object({query:z.string().trim().max(100).default(""),includeConfirmed:z.enum(["true","false"]).default("false"),offset:z.coerce.number().int().min(0).max(100000).default(0),limit:z.coerce.number().int().min(1).max(100).default(50)});
export const groupChangesSchema=z.object({rows:z.array(z.object({key:z.string(),namespace:z.string(),external_id:z.string(),employee_id:z.string().uuid().nullable(),name:z.string(),employee_number:z.string(),old_groups:z.array(z.string()),new_groups:z.array(z.string()),variants:z.array(z.array(z.string())),observed_at:z.string(),detected_at:z.string(),file_name:z.string(),previous_file:z.string(),source_id:z.string(),time_origin:z.enum(["filename","received"]),status:z.enum(["pending","confirmed","conflict","unlinked"])})),total:z.number().int(),pending:z.number().int(),checkedFiles:z.number().int(),checkedAt:z.string()});
export type GroupChanges=z.infer<typeof groupChangesSchema>;
