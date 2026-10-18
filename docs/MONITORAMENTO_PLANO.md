# Plano de execução — Monitoramento do CD

Base confirmada em 17/10/2026: `develop`, `a76acdb6a0f8921743d1a9de85a631d34fc203e3`.
Nenhum arquivo versionado modificado no início. Prompt e pasta Defense estavam não versionados.
Não existe índice CodeGraph. Dados pessoais locais e arquivos originais são preservados.

## Etapas

1. Inventário e baseline: concluídos; 239 testes em 27 arquivos e typecheck aprovados.
2. Correções de Chamada, Banco de Horas, integridade SQL e importador RH: concluídas localmente.
3. Parsers, snapshot estável, varredura/worker e fotos: concluídos; arquivos reais validados em banco descartável.
4. Motor de jornadas, cobertura, estados e políticas: concluído, com testes numéricos e integração SQL.
5. Persistência/RPCs restritas, interface, conciliação e exportação: concluídas localmente.
6. Integração, testes de banco descartável, build, validação visual e relatório: evidências consolidadas em [MONITORAMENTO_ENTREGA.md](MONITORAMENTO_ENTREGA.md).

## Limites da execução

Banco de testes: PGlite descartável, sem conexão ao Supabase remoto. Nenhuma migration remota, push ou deploy está autorizada nesta etapa.
O importador recorrente não substitui nem remove as travas da baseline RH.
Vínculos entre RH, Defense e CPF/PIS exigem evidência. Nomes geram candidatos, nunca vínculos automáticos.
Ausência de escala, cobertura declarada ou saída identificada do perímetro gera pendência explícita.

## Arquivos reais localizados

- `ACESSOS DEFENSE`: duas exportações XLSX e 299 arquivos JPEG.
- `relogio de ponto`: dois arquivos AFD.
- Resultados de leitura e conciliação registrados em [monitoramento-importacao.md](monitoramento-importacao.md), sem conteúdo pessoal.
