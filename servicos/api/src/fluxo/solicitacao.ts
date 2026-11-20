import { Competencia } from '../dominio/Competencia';
import type { Papel } from '../dominio/Papel';
import { FiltragemColaborativa } from '../estrategias/FiltragemColaborativa';
import type { RecomendacaoStrategy } from '../estrategias/RecomendacaoStrategy';
import { RegrasOrcamento } from '../estrategias/RegrasOrcamento';
import { SimilaridadeCosseno } from '../estrategias/SimilaridadeCosseno';
import { PacoteServico } from '../servicos/PacoteServico';
import { ServicoAtomico } from '../servicos/ServicoAtomico';
import type { ServicoProjeto } from '../servicos/ServicoProjeto';
import type { SolicitacaoRecomendacao } from '../SistemaRecomendacao';

export const ESTRATEGIAS = new Map<string, RecomendacaoStrategy>(
  [new SimilaridadeCosseno(), new FiltragemColaborativa(), new RegrasOrcamento()].map((e) => [e.nome, e]),
);

/**
 * O pedido do produtor em POST /recomendacoes. Só tipo, nome e produtor são obrigatórios; o resto vem do modelo.
 * É guardado como veio no serviço de projetos, e daqui sai o projeto de novo a cada operação do produtor.
 */
export interface CorpoRecomendacao {
  tipo: string;
  modelo?: string;
  nome: string;
  produtor: string;
  genero?: string;
  duracao?: number;
  orcamento?: number;
  prazo?: string;
  localizacao?: string;
  /** Árvore de serviços; sem ela, vale a do modelo. */
  servico?: CorpoServico;
  estrategia?: string;
  /** Pilha de decoradores preferida pelo produtor, de fora para dentro. */
  decoradores?: string[];
  /** Tema, técnica, cliente... conforme o tipo. */
  detalhes?: Record<string, unknown>;
}

export type CorpoServico =
  | { nome: string; servicos: CorpoServico[] }
  | { nome: string; papel: Papel; custo: number; prazo: string; competencias?: { nome: string; nivel: number }[] };

/** Com o id, o projeto recriado é o mesmo: mesmo modelo, mesma árvore, mesmas restrições. */
export function solicitacaoDoCorpo(corpo: CorpoRecomendacao, id?: string): SolicitacaoRecomendacao {
  return {
    id,
    tipo: corpo.tipo,
    modelo: corpo.modelo,
    detalhes: corpo.detalhes,
    nome: corpo.nome,
    produtor: corpo.produtor,
    genero: corpo.genero,
    duracao: corpo.duracao,
    servicoPrincipal: corpo.servico === undefined ? undefined : servicoDoCorpo(corpo.servico),
    restricoes: {
      orcamento: corpo.orcamento,
      prazo: corpo.prazo === undefined ? undefined : new Date(corpo.prazo),
      localizacao: corpo.localizacao,
    },
    estrategia: corpo.estrategia === undefined ? undefined : ESTRATEGIAS.get(corpo.estrategia),
    decoradores: corpo.decoradores,
  };
}

export function servicoDoCorpo(corpo: CorpoServico): ServicoProjeto {
  if ('servicos' in corpo) return new PacoteServico(corpo.nome, corpo.servicos.map(servicoDoCorpo));
  return new ServicoAtomico({
    nome: corpo.nome,
    custoBase: corpo.custo,
    prazoBase: new Date(corpo.prazo),
    papelNecessario: corpo.papel,
    competenciasDesejadas: (corpo.competencias ?? []).map((c) => new Competencia(c.nome, c.nivel)),
  });
}
