/**
 * Ciclo de vida do projeto audiovisual:
 * em_formacao (equipe recomendada, convites em aberto) -> equipe_formada (todos aceitaram) -> finalizado
 * (produção encerrada, com métricas e resultados). Uma reavaliação devolve o projeto a em_formacao.
 */
export const STATUS_PROJETO = ['em_formacao', 'equipe_formada', 'finalizado'] as const;
export type StatusProjeto = (typeof STATUS_PROJETO)[number];

export interface MembroDTO {
  papel: string;
  profissionalId: string;
  nome: string;
  precoMedio: number;
}

/** O que a api envia para registrar (ou atualizar) um projeto. */
export interface RegistroProjeto {
  id: string;
  tipo: string;
  nome: string;
  produtor: string;
  orcamento: number;
  /** Data de entrega, AAAA-MM-DD. */
  prazo: string;
  custoEstimado: number;
  /**
   * O pedido com que a api criou o projeto. O serviço de projetos só guarda; a api o usa para recriar o objeto
   * de domínio (com a árvore de serviços) quando o produtor volta a mexer na equipe.
   */
  solicitacao: unknown;
}

export interface ProjetoDTO extends RegistroProjeto {
  status: StatusProjeto;
  /** Composição final, quando a equipe é formada. */
  equipe: MembroDTO[] | null;
  metricas: Record<string, number> | null;
  resultados: string | null;
  criadoEm: string;
  atualizadoEm: string;
  finalizadoEm: string | null;
}

export interface Finalizacao {
  metricas?: Record<string, number>;
  resultados?: string;
}

/** Operações aceitas na fila `consulta-projetos`. */
export const OPERACOES_PROJETOS = {
  /** RegistroProjeto -> ProjetoDTO. Idempotente: registrar de novo o mesmo id atualiza os dados. */
  registrar: 'registrar',
  /** { id } -> ProjetoDTO */
  buscar: 'buscar',
  /** { id, equipe: MembroDTO[] } -> ProjetoDTO, com status equipe_formada */
  formarEquipe: 'formarEquipe',
  /** { id, alteracoes: Partial<RegistroProjeto> } -> ProjetoDTO, de volta a em_formacao e sem equipe */
  reabrir: 'reabrir',
} as const;

export const PROJETO_NAO_ENCONTRADO = 'PROJETO_NAO_ENCONTRADO';
export const TRANSICAO_INVALIDA = 'TRANSICAO_INVALIDA';

/** Tipos publicados em `eventos-projetos`. */
export const EVENTOS_PROJETO = {
  criado: 'projeto_criado',
  atualizado: 'projeto_atualizado',
  finalizado: 'projeto_finalizado',
} as const;

/** O projeto sem a solicitação, que só interessa à api. */
export type ResumoProjeto = Omit<ProjetoDTO, 'solicitacao'>;

export interface DadosEventoProjeto {
  projeto: ResumoProjeto;
  /** O que mudou, nos eventos de atualização: dados, equipe_formada ou reavaliacao. */
  motivo?: string;
}
