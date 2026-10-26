# Supabase do RH Conect na VPS

O site continua na Vercel, em `https://administrativo-cd-rh.vercel.app`. PostgreSQL, Auth, API, Storage e as rotinas do banco estão no serviço **supabase-rh-conect**, projeto **RH Conect / production** do Coolify.

- API e Studio: `https://supabase-rh.nexusmax.cloud`.
- VPS: `179.197.78.61`; acesso administrativo pelo alias SSH `hostinger`.
- Serviço Coolify: `2crtcbnuzdqena1tn3jwb9sy`.
- PostgreSQL: container `db-2crtcbnuzdqena1tn3jwb9sy`, versão 17.6. A porta PostgreSQL não está publicada na internet.
- Configuração e volumes: `/data/rh-conect-supabase`. As credenciais ficam nesse diretório restrito e nas variáveis do Coolify. Nunca devem entrar no Git.
- A versão do Supabase foi fixada em `self-hosted/v0.8.3`, commit `bc27d2661edd09a5d0b8d76ce33da6d4071a756e`.

## Conexão da aplicação

Produção e prévia usam `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` da VPS. A chave de serviço fica somente em `MONITORING_SUPABASE_SERVICE_ROLE_KEY`, no servidor. `SUPABASE_SELF_HOSTED_ORIGIN` autoriza explicitamente o domínio de Storage.

`MONITORING_SUPABASE_PROJECT_REF=kqgtnucqxqqgwdyvhvdd` preserva a identidade dos históricos existentes. Esse identificador **não é o destino de conexão**. O projeto antigo do Supabase é apenas uma cópia de retorno, em somente leitura e com cron desativado. Não aplique nele as próximas migrações da aplicação.

A origem tinha confirmação de e-mail desativada e login por identificador técnico derivado do CPF. Essa configuração foi preservada. Os hashes de senha, usuários, políticas e permissões foram migrados. As sessões emitidas com a chave antiga exigem novo login.

## Validação de 26/10/2026

Foram conferidas 90 tabelas por contagem e hash após a cópia final. A tabela de fotos foi verificada separadamente: 384 imagens preservadas, agora com a versão ampliada no bucket privado `monitoramento-fotos`. Os 3.560 objetos anteriores foram enviados e relidos, conferindo cada SHA-256. O total inicial após as fotos é de 3.944 objetos.

A aplicação publicada passou por login com conta temporária, leitura autenticada de foto ampliada e avatar com conferência dos hashes, e recusa de acesso anônimo. A conta temporária foi removida. As rotinas `employee-lifecycle-monitor` e `monitoring-cloud-dispatch` voltaram a executar com sucesso na VPS.

O banco, que tinha aproximadamente 799 MB na origem, passou a aproximadamente 350 MB após restauração e otimização. Cerca de 512 MB de arquivos ficam separados no Storage. Esses valores variam com as importações e rotinas.

## Backups e operação

O script `operations/self-hosted/backup-rh-conect.sh` foi instalado em `/data/rh-conect-supabase/backup-rh-conect.sh`. O agendamento `/etc/cron.d/rh-conect-backup` executa diariamente às 06:20 UTC, 03:20 em São Paulo. Mantém 14 dias de arquivos concluídos.

Os backups ficam em `/data/rh-conect-backups`, acessível apenas ao administrador. Contêm os bancos `postgres` e `_supabase`, roles, configuração e arquivos do Storage, com checksum SHA-256. O arquivo inclui credenciais e dados pessoais: não deve ser publicado ou anexado ao Git.

A execução inicial foi verificada por leitura do arquivo tar e dos catálogos dos dumps. Há também cópias da migração e do backup fora da VPS, no diretório local ignorado `artifacts/vps-migration-2026-10-26`. Backups diários na própria VPS não substituem uma política contínua de cópia externa.

Para manutenção, use SSH/Coolify no serviço indicado. Confirme a ausência de importações em execução antes de reiniciar. Para recuperar, prepare um destino isolado na mesma versão, restaure configuração, roles, bancos e arquivos, confira os hashes e valide login, permissões e fotos antes de trocar a aplicação. Não reverta a URL para o projeto antigo sem reconciliar as gravações feitas após a migração.
