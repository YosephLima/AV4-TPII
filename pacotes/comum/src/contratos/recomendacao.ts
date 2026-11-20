/** Tipos publicados pela api em `eventos-recomendacao`. Os seis primeiros são os eventos do Observer da AV1. */
export const EVENTOS_RECOMENDACAO = {
  recomendacaoGerada: 'recomendacao_gerada',
  membroSubstituido: 'membro_substituido',
  conviteAceito: 'convite_aceito',
  conviteRecusado: 'convite_recusado',
  reavaliacaoSolicitada: 'reavaliacao_solicitada',
  equipeFormada: 'equipe_formada',
  /** Convite redigido pelo notificador da família do projeto, para o serviço de notificações entregar. */
  conviteEnviado: 'convite_enviado',
} as const;

export interface Envolvido {
  profissionalId: string;
  nome: string;
  papel: string;
}

export interface DadosEventoRecomendacao {
  projetoId: string;
  projetoNome: string;
  tipoProjeto: string;
  produtor: string;
  envolvidos: Envolvido[];
}

export interface DadosConvite {
  para: string;
  assunto: string;
  corpo: string;
}
