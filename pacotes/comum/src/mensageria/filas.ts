/**
 * Nomes das filas duráveis. `consulta-profissionais` e `eventos-projetos` vêm do enunciado; as outras duas
 * preenchem lacunas dele (veja docs/AV4.md).
 */
export const FILAS = {
  /** RPC: a api pergunta, o serviço de profissionais responde. */
  consultaProfissionais: 'consulta-profissionais',
  /** RPC: a api registra e consulta projetos no serviço de projetos, a fonte de verdade deles. */
  consultaProjetos: 'consulta-projetos',
  /** Eventos: o serviço de projetos publica, o de notificações consome. */
  eventosProjetos: 'eventos-projetos',
  /** Eventos: a api publica os eventos da recomendação (convites, equipe formada...), o de notificações consome. */
  eventosRecomendacao: 'eventos-recomendacao',
} as const;
