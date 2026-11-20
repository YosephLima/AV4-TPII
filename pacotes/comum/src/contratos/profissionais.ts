/** Formato do profissional na fila `consulta-profissionais`. Datas em ISO 8601. */
export interface ProfissionalDTO {
  id: string;
  nome: string;
  especialidades: string[];
  competencias: CompetenciaDTO[];
  avaliacoes: AvaliacaoDTO[];
  precoMedio: number;
  disponibilidade: { inicio: string; fim: string };
  localizacao: string;
  projetosAnteriores: string[];
}

export interface CompetenciaDTO {
  nome: string;
  nivel: number;
}

export interface AvaliacaoDTO {
  nota: number;
  comentario: string;
  data: string;
}

export interface CriteriosProfissionais {
  /** Quem atua em pelo menos um destes papéis. */
  papeis?: string[];
  localizacao?: string;
}

export interface PedidoAvaliacao {
  profissionalId: string;
  avaliacao: AvaliacaoDTO;
}

/** Operações aceitas na fila `consulta-profissionais` e o que cada uma recebe e devolve. */
export const OPERACOES_PROFISSIONAIS = {
  /** CriteriosProfissionais -> ProfissionalDTO[] */
  listar: 'listar',
  /** { id } -> ProfissionalDTO */
  detalhar: 'detalhar',
  /** PedidoAvaliacao -> null */
  avaliar: 'avaliar',
} as const;

export const PROFISSIONAL_NAO_ENCONTRADO = 'PROFISSIONAL_NAO_ENCONTRADO';
