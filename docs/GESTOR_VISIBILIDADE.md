# Visualização de todas as equipes pelo gerente

Em **Usuários > Editar usuário**, ADMIN ou RH pode manter o papel **GESTOR**, selecionar o gestor do quadro e marcar **Visualizar todos os gestores**. A edição exige justificativa e a versão atual do cadastro; a alteração fica no histórico.

A opção amplia consultas no Quadro Atual, Banco de Horas, Chamada Diária, Monitoramento, férias e planejamento. O papel permanece GESTOR. Lançamentos, revisões, anexos, horários e propostas continuam restritos à equipe vinculada. Importações, cadastros administrativos, correções de banco e administração de usuários permanecem sujeitos aos papéis originais.

O padrão é desativado. Desmarcar a opção revoga a leitura global; trocar para outro papel limpa a opção. O usuário não pode habilitá-la no próprio perfil por escrita direta ou metadados de autenticação.

## Banco de produção

A migração fonte `20261023203526_manager_all_teams_read_scope.sql` foi aplicada no projeto Supabase `administrativo-cd-rh` (`kqgtnucqxqqgwdyvhvdd`) em 23/10/2026. O serviço registrou a versão `20261023204740`, com o nome `manager_all_teams_read_scope`.

A validação no banco utilizou o papel SQL `authenticated` dentro de uma transação revertida. Foram verificados o escopo original, a leitura global, a manutenção do papel GESTOR e as recusas de administração, importação e escrita em outra equipe. Nenhuma opção permaneceu habilitada nos perfis existentes. Essa evidência de autorização no banco é distinta da conferência visual no navegador.
