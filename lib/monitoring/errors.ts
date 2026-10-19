/** User-facing descriptions never include database messages or personal payloads. */
export function monitoringErrorCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return typeof code === "string" && /^[A-Z0-9_]{3,60}$/.test(code) ? code : "MONITORING_FAILURE";
}

export function monitoringErrorMessage(error: unknown): string {
  const code = monitoringErrorCode(error);
  if (code === "PGRST202" || code === "42883") return "O Monitoramento ainda não está habilitado no banco deste ambiente. A administração precisa concluir a instalação antes de importar arquivos e fotos.";
  if (code === "MONITORING_SERVER_CREDENTIAL_MISSING") return "A importação ainda não está configurada neste servidor. Solicite à administração a habilitação do processo de importação.";
  if (code === "42501") return "Acesso não autorizado.";
  if (code === "MONITORING_SNAPSHOT_CHANGED") return "Os dados mudaram durante a consulta. Atualize para obter totais consistentes.";
  if (code === "MONITORING_PERIOD_TOO_LARGE") return "Reduza o período para consultar até 200.000 jornadas.";
  if (code === "MONITORING_INCOMPLETE_PAGE") return "A consulta retornou uma página incompleta. Atualize; nenhum total parcial foi apresentado.";
  return "Falha no Monitoramento. Confira a configuração do servidor e tente novamente.";
}
