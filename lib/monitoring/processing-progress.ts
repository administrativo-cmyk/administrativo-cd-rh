import { z } from "zod";
export const processingProgressSchema=z.object({
 checkedAt:z.string(),datasetVersion:z.string(),start:z.string(),end:z.string(),
 total:z.number().int().nonnegative(),completed:z.number().int().nonnegative(),pending:z.number().int().nonnegative(),
 running:z.number().int().nonnegative(),deferred:z.number().int().nonnegative(),failed:z.number().int().nonnegative(),
 limited:z.number().int().nonnegative(),withoutData:z.number().int().nonnegative(),lastCalculationAt:z.string().nullable(),
 activeImports:z.number().int().nonnegative().nullable(),imports:z.array(z.object({
  id:z.string(),fileName:z.string(),status:z.enum(["uploading","queued","processing","completed","failed","cancelled"]),
  processedRows:z.number().int().nonnegative(),totalRows:z.number().int().nonnegative().nullable(),completedAt:z.string().nullable(),
 })),
}).refine(p=>p.completed+p.pending===p.total,"Contagem de recálculo inconsistente");
export type ProcessingProgress=z.infer<typeof processingProgressSchema>;
export function processingPercentage(progress:Pick<ProcessingProgress,"total"|"completed">){
 return progress.total?Math.min(100,Math.floor(1000*progress.completed/progress.total)/10):null;
}
