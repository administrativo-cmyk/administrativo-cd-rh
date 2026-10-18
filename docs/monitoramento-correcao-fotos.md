# Correção da ingestão de fotos — 17/10/2026

O endpoint local de fotos respondia `503 / ERR_INVALID_ARG_VALUE`. Uma única foto do pipeline reproduziu o erro, com correlação `3a17a2eb-421c-4126-8011-74025aa66a40`.

`createRequire(import.meta.url)` recebia o endereço virtual gerado pelo Turbopack. O novo helper `lib/monitoring/photo-thumbnail.ts` resolve o decodificador da árvore do Next a partir do caminho real de `package.json`; a rota declara runtime Node.js.

Token, fonte permitida, limite do corpo e conferência do hash continuam obrigatórios. O helper valida tamanho e formato, limita a decodificação a 20 milhões de pixels, aplica orientação e gera JPEG de até 128 × 128 sem metadados. Imagem inválida retorna 400; falha operacional mantém 503 com correlação sanitizada.

Validação executada:

- Cinco testes passaram: miniatura real com orientação/metadados, imagem inválida, credencial/fonte/hash, persistência da miniatura normalizada e erro operacional sem detalhes privados.
- ESLint dos arquivos alterados e `npm run typecheck` passaram.
- Repetição da mesma foto pelo pipeline local autorizado: HTTP 200, `accepted: true`. O diagnóstico fez somente uma requisição antes e uma depois da correção; não imprimiu foto, identidade ou credenciais e não alterou o checkpoint do worker.

Essa prova confirma o endpoint de uma foto. A retomada do lote e a conferência visual das fotos pertencem à validação integrada conduzida pela tarefa principal. O build isolado anterior ocorreu antes desta correção e não é evidência de build destes arquivos.
