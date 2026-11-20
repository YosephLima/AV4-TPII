import type { ProfissionalDTO } from '@cinebridge/comum';
import { Avaliacao } from '../dominio/Avaliacao';
import { Competencia } from '../dominio/Competencia';
import { Papel } from '../dominio/Papel';
import { Profissional } from '../dominio/Profissional';

const PAPEIS = new Set<string>(Object.values(Papel));

/** Do formato da fila para o domínio. Papéis que a api não conhece são ignorados. */
export function profissionalDoDTO(dto: ProfissionalDTO): Profissional {
  return new Profissional({
    id: dto.id,
    nome: dto.nome,
    especialidades: dto.especialidades.filter((e) => PAPEIS.has(e)) as Papel[],
    competencias: dto.competencias.map((c) => new Competencia(c.nome, c.nivel)),
    avaliacoes: dto.avaliacoes.map((a) => new Avaliacao(a.nota, a.comentario, new Date(a.data))),
    precoMedio: dto.precoMedio,
    disponibilidade: { inicio: new Date(dto.disponibilidade.inicio), fim: new Date(dto.disponibilidade.fim) },
    localizacao: dto.localizacao,
    projetosAnteriores: dto.projetosAnteriores,
  });
}

export function dtoDoProfissional(p: Profissional): ProfissionalDTO {
  return {
    id: p.id,
    nome: p.nome,
    especialidades: [...p.especialidades],
    competencias: p.competencias.map(({ nome, nivel }) => ({ nome, nivel })),
    avaliacoes: p.avaliacoes.map((a) => ({ nota: a.nota, comentario: a.comentario, data: a.data.toISOString() })),
    precoMedio: p.precoMedio,
    disponibilidade: { inicio: p.disponibilidade.inicio.toISOString(), fim: p.disponibilidade.fim.toISOString() },
    localizacao: p.localizacao,
    projetosAnteriores: [...p.projetosAnteriores],
  };
}
