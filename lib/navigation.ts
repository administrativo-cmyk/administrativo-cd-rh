import type { UserRole } from "@/lib/auth/types";
export const pageCatalog = [
 {label:"Dashboards",href:"/dashboards",description:"Escolha um painel de indicadores"},
 {label:"Dashboard de Monitoramento",href:"/dashboards/monitoramento",description:"Ponto, acesso e tempo na operação"},
 {label:"Dashboard da Chamada Diária",href:"/dashboards/chamada-diaria",description:"Marcações, pendências e evolução"},
 {label:"Dashboard de Banco de Horas",href:"/dashboards/banco-de-horas",description:"Saldos, compensações e reposições"},
 {label:"Dashboard do Quadro Atual",href:"/dashboards/quadro-atual",description:"Efetivo e qualidade cadastral"},
 {label:"Monitoramento",href:"/monitoramento",description:"Consulta, importação, conciliação e configuração"},
 {label:"Chamada Diária",href:"/chamada-diaria",description:"Consultar e preencher a chamada"},
 {label:"Banco de Horas",href:"/banco-de-horas",description:"Consultar saldos e compensações"},
 {label:"Quadro Atual",href:"/quadro-atual",description:"Consultar colaboradores"},
 {label:"Sugestão de Férias",href:"/planejamento/ferias",description:"Criar e revisar programações"},
 {label:"Férias por Gestor e Mês",href:"/planejamento/calendario",description:"Calendário das equipes"},
 {label:"Top 20",href:"/analises/top-20-banco-horas",description:"Maiores créditos e débitos"},
 {label:"Top por Gestor",href:"/analises/top-por-gestor",description:"Comparação por equipe"},
 {label:"Afastados e Outros",href:"/analises/afastados-e-outros",description:"Situações do quadro atual"},
 {label:"Metodologia",href:"/analises/metodologia",description:"Fontes e critérios dos indicadores"},
 {label:"Cadastros",href:"/administracao",description:"Unidades, gestores e colaboradores",administrative:true},
 {label:"Setores",href:"/administracao/setores",description:"Cadastrar, editar e arquivar setores",administrative:true},
 {label:"Cargos / funções",href:"/administracao/cargos",description:"Catálogo de cargos e funções",administrative:true},
 {label:"Categorias",href:"/administracao/categorias",description:"Categorias dos colaboradores",administrative:true},
 {label:"Escalas e calendário",href:"/planejamento/escalas",description:"Modelos, atribuição por equipe e feriados",administrative:true},
 {label:"Sugestões automáticas de férias",href:"/planejamento/sugestoes-ferias",description:"Critérios do RH e capacidade das equipes"},
 {label:"Histórico de alterações",href:"/administracao/auditoria",description:"Responsáveis, justificativas e valores antes e depois",administrative:true},
 {label:"Medições do Banco de Horas",href:"/administracao/banco-horas",description:"Cadastrar, revisar, cancelar e restaurar medições",administrative:true},
 {label:"Usuários",href:"/usuarios",description:"Acessos e permissões",administrative:true},
 {label:"Notificações",href:"/notificacoes",description:"Avisos e decisões de planejamento"},
 {label:"Configurações",href:"/configuracoes",description:"Meu perfil e preferências"},
];
export function visiblePages(role:UserRole|null,query=""){
 const normalized=query.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
 return pageCatalog.filter(page=>(!page.administrative||role==="ADMIN"||role==="RH")&&`${page.label} ${page.description}`.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().includes(normalized));
}
