import type { AvaliacaoDTO, CriteriosProfissionais, ProfissionalDTO } from '@cinebridge/comum';
import { Papel, type PrismaClient } from '../generated/prisma/client';
import { naoEncontrado, type Cadastro } from './Cadastro';

type ClientePrisma = Pick<PrismaClient, 'profissional' | 'avaliacao' | '$queryRaw'>;

const PAPEIS = new Set<string>(Object.values(Papel));
const INCLUIR = { competencias: true, avaliacoes: true } as const;

export class CadastroPostgres implements Cadastro {
  constructor(private readonly prisma: ClientePrisma) {}

  async listar(criterios: CriteriosProfissionais = {}): Promise<ProfissionalDTO[]> {
    // Um papel que o banco não conhece não pode casar com ninguém, e o Prisma recusaria o valor.
    const papeis = criterios.papeis?.filter((p) => PAPEIS.has(p)) as Papel[] | undefined;
    if (criterios.papeis && papeis?.length === 0) return [];

    const registros = await this.prisma.profissional.findMany({
      where: {
        ...(papeis ? { especialidades: { hasSome: papeis } } : {}),
        ...(criterios.localizacao ? { localizacao: criterios.localizacao } : {}),
      },
      include: INCLUIR,
      orderBy: { id: 'asc' },
    });
    return registros.map(paraDTO);
  }

  async detalhar(id: string): Promise<ProfissionalDTO> {
    const registro = await this.prisma.profissional.findUnique({ where: { id }, include: INCLUIR });
    if (!registro) throw naoEncontrado(id);
    return paraDTO(registro);
  }

  async avaliar(id: string, avaliacao: AvaliacaoDTO): Promise<void> {
    await this.detalhar(id);
    await this.prisma.avaliacao.create({
      data: { profissionalId: id, nota: avaliacao.nota, comentario: avaliacao.comentario, data: new Date(avaliacao.data) },
    });
  }

  async verificar(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}

interface Registro {
  id: string;
  nome: string;
  especialidades: Papel[];
  precoMedio: number;
  disponivelDe: Date;
  disponivelAte: Date;
  localizacao: string;
  projetosAnteriores: string[];
  competencias: { nome: string; nivel: number }[];
  avaliacoes: { nota: number; comentario: string; data: Date }[];
}

function paraDTO(r: Registro): ProfissionalDTO {
  return {
    id: r.id,
    nome: r.nome,
    especialidades: r.especialidades,
    competencias: r.competencias.map(({ nome, nivel }) => ({ nome, nivel })),
    avaliacoes: r.avaliacoes.map((a) => ({ nota: a.nota, comentario: a.comentario, data: a.data.toISOString() })),
    precoMedio: r.precoMedio,
    disponibilidade: { inicio: r.disponivelDe.toISOString(), fim: r.disponivelAte.toISOString() },
    localizacao: r.localizacao,
    projetosAnteriores: r.projetosAnteriores,
  };
}
