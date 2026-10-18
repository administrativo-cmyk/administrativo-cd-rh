# Administrativo CD

Sistema web administrativo de RH e operação dos centros de distribuição.

## Estado local — 17/10/2026

Chamada Diária, Banco de Horas, Quadro Atual, usuários e Monitoramento usam persistência e autorização reais. A importação de ponto, acessos Defense e fotos está ativada no banco. A associação das batidas aos colaboradores ainda depende do cadastro matrícula–CPF/PIS; indicadores sem evidência permanecem não apuráveis.

Os novos dashboards em `/dashboards` separam Monitoramento, Chamada, Banco de Horas e Quadro Atual. As análises ficam em `/analises`; planejamento em `/planejamento/ferias` e `/planejamento/calendario`; cadastros em `/administracao`; caixa de avisos em `/notificacoes`; perfil e preferências em `/configuracoes`.

O novo CRUD administrativo, planejamento, notificações, preferências e revisões de usuários/configurações estão em validação local. Sua ativação remota é separada do pacote anterior. Consulte o [plano completo](docs/PLANO_SISTEMA_COMPLETO.md), a [validação atual e suas pendências](docs/SISTEMA_COMPLETO_VALIDACAO.md) e o [registro de interface](docs/DASHBOARDS_CALENDARIO_UI.md).

Referências do Monitoramento: [regras de cálculo](docs/monitoramento-regras.md), [importador Windows](docs/monitoramento-importacao.md) e [correções da base](docs/monitoramento-correcoes.md). Relatórios antigos preservam o estado histórico da etapa documentada.

## Stack

- Next.js
- React
- TypeScript
- Supabase
- PostgreSQL

## Comandos

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm test:migrations
pnpm build
```

Validação dos arquivos locais, sem persistência:

```powershell
pnpm monitoring:dry --config monitoramento.example.json
```

Dados pessoais, fotos, configurações locais e checkpoints são ignorados pelo Git. Variáveis necessárias, sem valores secretos, constam em `.env.example`.
