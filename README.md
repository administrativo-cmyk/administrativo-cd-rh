# Administrativo CD

Protótipo funcional da rotina de Chamada Diária, construído com Next.js 16 (App Router), React 19, TypeScript e Tailwind CSS.

## Comandos

- `pnpm dev`: inicia o servidor local do Next.js.
- `pnpm typecheck`: valida os tipos TypeScript.
- `pnpm lint`: executa o ESLint.
- `pnpm test`: executa a suíte Vitest.
- `pnpm test:migrations`: recria o schema em PostgreSQL WASM e valida constraints, RLS e ciclos de BH.
- `pnpm build`: gera o build de produção do Next.js.
- `pnpm start`: serve o build localmente.

## Supabase local

- `pnpm supabase:start`: inicia a stack local quando Docker estiver disponível.
- `pnpm supabase:reset`: recria somente o banco local a partir das migrations.
- `pnpm supabase:status`: mostra o estado da stack local.

A estrutura local está em `supabase/`. Não existe `supabase link`, project ref, credencial real ou conexão da UI com o banco nesta etapa.

Os dados visíveis na interface continuam fictícios e somente em memória. A fundação PostgreSQL ainda não é usada pela UI; não há autenticação, sincronização externa nem configuração de deploy.
