import type { ProfissionalDTO } from '@cinebridge/comum';
import { Equipe, MembroEquipe, type Recomendacoes, type StatusEquipe } from '../dominio/Equipe';
import type { Papel } from '../dominio/Papel';
import type { Projeto } from '../dominio/Projeto';
import { dtoDoProfissional, profissionalDoDTO } from '../mapeamento/profissionais';

/**
 * Tudo o que é preciso para recriar a equipe numa próxima requisição: membros com a confirmação e o pagamento,
 * o ranking (as alternativas de cada papel) e quem já foi substituído. Os profissionais vão como estavam no
 * momento da recomendação, que é o que o produtor viu.
 */
export interface EstadoEquipe {
  id: string;
  dataFormacao: string;
  status: StatusEquipe;
  membros: { papel: Papel; profissional: ProfissionalDTO; confirmado: boolean; pagamentoId?: string }[];
  ranking: [Papel, ProfissionalDTO[]][];
  substituidos: string[];
}

/** O que GET /recomendacoes/:id devolve. */
export interface RecomendacaoArquivada {
  projetoId: string;
  nome: string;
  tipo: string;
  produtor: string;
  custoEstimado: number;
  data: string;
  status: StatusEquipe;
  equipe: { papel: string; profissionalId: string; nome: string; precoMedio: number; confirmado: boolean }[];
}

export interface RegistroRecomendacao extends RecomendacaoArquivada {
  estado: EstadoEquipe;
}

export function estadoDaEquipe(equipe: Equipe): EstadoEquipe {
  return {
    id: equipe.id,
    dataFormacao: equipe.dataFormacao.toISOString(),
    status: equipe.status,
    membros: equipe.membros.map((m) => ({
      papel: m.papel,
      profissional: dtoDoProfissional(m.profissional),
      confirmado: m.confirmado,
      ...(m.pagamentoId ? { pagamentoId: m.pagamentoId } : {}),
    })),
    ranking: [...equipe.ranking].map(([papel, lista]) => [papel, lista.map(dtoDoProfissional)]),
    substituidos: [...equipe.substituidos],
  };
}

export function equipeDoEstado(estado: EstadoEquipe): Equipe {
  const membros = estado.membros.map((m) => {
    const membro = new MembroEquipe(m.papel, profissionalDoDTO(m.profissional));
    if (m.confirmado) membro.confirmar();
    membro.pagamentoId = m.pagamentoId;
    return membro;
  });
  const ranking: Recomendacoes = new Map(estado.ranking.map(([papel, lista]) => [papel, lista.map(profissionalDoDTO)]));
  const equipe = new Equipe(membros, ranking, estado.id, new Date(estado.dataFormacao));
  equipe.status = estado.status;
  for (const id of estado.substituidos) equipe.substituidos.add(id);
  return equipe;
}

export function registroDe(projeto: Projeto, equipe: Equipe): RegistroRecomendacao {
  return {
    projetoId: projeto.id,
    nome: projeto.nome,
    tipo: projeto.tipo,
    produtor: projeto.produtor,
    custoEstimado: projeto.calcularCustoTotal(),
    data: equipe.dataFormacao.toISOString(),
    status: equipe.status,
    equipe: equipe.membros.map((m) => ({
      papel: m.papel,
      profissionalId: m.profissional.id,
      nome: m.profissional.nome,
      precoMedio: m.profissional.precoMedio,
      confirmado: m.confirmado,
    })),
    estado: estadoDaEquipe(equipe),
  };
}

export function semEstado({ estado: _estado, ...arquivada }: RegistroRecomendacao): RecomendacaoArquivada {
  return arquivada;
}
