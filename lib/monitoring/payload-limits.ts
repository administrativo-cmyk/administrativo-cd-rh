// Vercel accepts at most 4,500,000 bytes per request. Reserve space below that
// ceiling, and an additional 100 KB for multipart fields, boundaries and names.
export const httpBodyLimitBytes = 4_400_000;
export const importFileLimitBytes = 4_300_000;
export const importFileLimitLabel = "4,3 MB (4.300.000 bytes)";
export const importFileLimitMessage = `Envie CSV ou XLSX de até ${importFileLimitLabel}. Divida arquivos maiores antes de importar.`;
