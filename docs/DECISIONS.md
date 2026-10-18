# Decisoes arquiteturais

> Registro histórico de decisões por etapa. Auditoria, permissões e persistência evoluíram nas migrations posteriores; consulte [MONITORAMENTO_ENTREGA.md](MONITORAMENTO_ENTREGA.md) para a situação local atual.

## Enums versus tabelas de dominio

Foram usados enums para codigos pequenos, fechados e controlados pelo sistema: situacao do colaborador, codigo da chamada e estados de importacao. Categoria, movimento, origem e textos de RH permanecem `text`, pois podem evoluir sem migration de enum.

## Saldo canonico em minutos

O banco armazena `saldo_minutos`, evitando inconsistencias entre decimal, HH:MM e dias. A view e o dominio TypeScript derivam as demais apresentacoes.

## Regra das cinco horas

Primeiro sao contadas jornadas completas. O restante acrescenta um dia somente quando for estritamente maior que 300 minutos. Exatamente cinco horas nao acrescentam dia. O sinal e reaplicado ao final.

## Baseline de compensacao

Cada medicao define um ciclo por `aplica_a_partir_de`. O ciclo termina imediatamente antes da proxima baseline. Um G e contado apenas quando sua data estiver dentro desse intervalo. Isso impede dupla compensacao depois de uma nova medicao.

## Historico cadastral

Nesta etapa foram adotados `updated_at` e `ultimo_lote_importacao_id`. Nao foi criada uma tabela generica de auditoria. Uma futura tabela de movimentacoes pode ser adicionada quando os eventos e requisitos de retencao forem aprovados.

## RLS e Auth

RLS foi habilitado sem policies. Grants de `anon` e `authenticated` foram revogados. Perfis e papeis `ADMIN`, `RH`, `GESTOR` e `LEITURA` estao apenas planejados; nenhuma permissao foi presumida.

Quando as policies forem aprovadas, qualquer view concedida a usuarios tambem exigira os grants minimos nas tabelas de origem e, para as views de banco de horas, acesso controlado a funcao pura no schema `private`.

## Tipos de persistencia

`lib/persistence/database.types.ts` e um contrato local separado do dominio. Quando o banco local completo estiver disponivel, ele deve ser regenerado com `supabase gen types --lang typescript --local`, sem importar o resultado diretamente nos componentes.
