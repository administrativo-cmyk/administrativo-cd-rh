# Chamada Diária: origens de escrita (Etapa 5D.1)

O `PUT /api/daily-call/entry` é um Route Handler, não uma Server Action. Por isso sua checagem CSRF é própria; a opção `serverActions.allowedOrigins` do Next.js não atua aqui. A validação ocorre antes da autenticação, do perfil ADMIN e da RPC.

Em `next dev`, a allowlist exata é `http://localhost:3000` e `http://127.0.0.1:3000`. Sem `Origin` serializado, com `Origin: null` ou `Sec-Fetch-Site: cross-site`, a escrita é rejeitada. `Host` e `X-Forwarded-*` não expandem a lista de origens confiáveis.

Em produção, configurar `APP_ORIGIN` **no servidor** como a origem HTTPS canônica, sem caminho nem barra final (por exemplo, `https://administrativo.example.com`). A escrita falha fechada se essa variável estiver ausente ou inválida. Não usar `NEXT_PUBLIC_` para essa configuração. O domínio de exemplo não foi configurado em nenhum ambiente real.
