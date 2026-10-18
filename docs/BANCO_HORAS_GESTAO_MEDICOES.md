# Gestão de medições do Banco de Horas

Página: `/administracao/banco-horas`. ADMIN e RH podem criar, editar, cancelar, restaurar e consultar o histórico. Gestor e Leitura continuam usando as consultas de saldo do próprio escopo, sem acesso ao CRUD administrativo.

## Medições e ciclos

- O saldo é gravado em minutos inteiros, com sinal. O formulário recebe `+08:30`, `-08:30` ou `00:00`.
- A data da medição identifica o extrato; “Aplicar a partir de” define o início do ciclo. A jornada vem do extrato informado. Não há débito automático de oito horas por edição.
- Uma pessoa pode ter somente uma medição **ativa** em cada início de vigência. Canceladas permanecem armazenadas. Restaurar conflita se outra medição ativa ocupa aquela data.
- O colaborador de uma medição existente é imutável. Para corrigir a pessoa, cancele o lançamento e crie uma medição para o colaborador correto.
- Cancelar remove a medição das leituras, sem excluir o registro. A medição anterior passa a reger o intervalo, inclusive os G nele registrados. Se nenhuma medição anterior existir, o saldo fica sem extrato.
- Medição futura só vale a partir da sua vigência. As regras existentes de conversão em dias e consumo de G permanecem.
- Chamada, Banco de Horas, Quadro Atual, dashboards e análises ignoram medições canceladas. A lotação continua sendo a cadastral atual, sem reconstrução histórica de equipe.

## Auditoria e concorrência

Cada criação, edição, cancelamento e restauração registra ator autenticado, justificativa, instante, valores anteriores e posteriores em `private.time_bank_measurement_audit`. A origem do lote importado é preservada. A tela apresenta o histórico administrativo; importações anteriores à funcionalidade não recebem auditoria retroativa inventada.

Editar, cancelar e restaurar exigem o `updated_at` consultado. Versão antiga produz conflito. O servidor impede acesso direto às medições/auditoria pelo navegador e valida ADMIN/RH novamente no banco. O perfil do ator permanece protegido por lock compartilhado durante a escrita.

As escritas preparam os jobs antes de travar a revisão de entrada e a medição, seguindo a ordem usada pelo worker. Alterar a baseline incrementa a versão de entrada, invalida os resultados afetados e reenfileira datas com evidência, resultados ou decisões persistidas desde a vigência afetada. Não são inventados dias de ausência nem cobertura.

O CRUD não reescreve a Chamada manual. A revisão automática é processada pelo worker existente; a resposta informa quantos dias estão enfileirados. Saldo corrigido de 480 para 481 minutos retira I automático somente na revisão com as demais evidências válidas; cancelar o único extrato deixa a ausência bloqueada por falta de saldo. Manual e limpeza manual continuam protegidos.

## Instalação e validação local

Migração nova: `20261018003605_time_bank_measurement_management.sql`, criada pela CLI. Depende das migrações anteriores, incluindo a infraestrutura administrativa que fornece timestamp monotônico.

API autenticada: `GET /api/time-bank-admin` para lista e `action=history&id=...` para auditoria. `POST` aceita `save`, `cancel` e `restore`, valida origem da requisição, limita o corpo e exige justificativa. Lista paginada com no máximo 200 linhas por requisição.

Testes em PGlite descartável cobrem permissões, CAS, ciclo anterior após cancelamento, G entre ciclos, restauração/conflito, medição futura, ausência de extrato nas leituras, rollback de entrada inválida, fila e revisão I→pendência. Testes de API/UI cobrem acesso, origem, versões, sinal, validação e feedback. Essa evidência é local; não comprova aplicação da migração ou escrita de medições reais no ambiente remoto.
