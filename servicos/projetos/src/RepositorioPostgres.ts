import type { MembroDTO, ProjetoDTO } from '@cinebridge/comum';
import type { Prisma, PrismaClient, Projeto } from '../generated/prisma/client';
import type { FiltroProjetos, RepositorioProjetos } from './Repositorio';

type ClientePrisma = Pick<PrismaClient, 'projeto' | '$queryRaw'>;

const json = (valor: unknown) => valor as Prisma.InputJsonValue;

export class RepositorioPostgres implements RepositorioProjetos {
  constructor(private readonly prisma: ClientePrisma) {}

  async buscar(id: string): Promise<ProjetoDTO | undefined> {
    const registro = await this.prisma.projeto.findUnique({ where: { id } });
    return registro ? paraDTO(registro) : undefined;
  }

  async listar(filtro: FiltroProjetos = {}): Promise<ProjetoDTO[]> {
    const registros = await this.prisma.projeto.findMany({ where: filtro, orderBy: { criadoEm: 'desc' } });
    return registros.map(paraDTO);
  }

  async salvar(projeto: ProjetoDTO): Promise<ProjetoDTO> {
    const dados = {
      tipo: projeto.tipo,
      nome: projeto.nome,
      produtor: projeto.produtor,
      status: projeto.status,
      orcamento: projeto.orcamento,
      prazo: new Date(projeto.prazo),
      custoEstimado: projeto.custoEstimado,
      solicitacao: json(projeto.solicitacao),
      equipe: projeto.equipe === null ? ('DbNull' as const) : json(projeto.equipe),
      metricas: projeto.metricas === null ? ('DbNull' as const) : json(projeto.metricas),
      resultados: projeto.resultados,
      finalizadoEm: projeto.finalizadoEm === null ? null : new Date(projeto.finalizadoEm),
    };
    const salvo = await this.prisma.projeto.upsert({
      where: { id: projeto.id },
      create: { id: projeto.id, ...dados },
      update: dados,
    });
    return paraDTO(salvo);
  }

  async verificar(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}

function paraDTO(r: Projeto): ProjetoDTO {
  return {
    id: r.id,
    tipo: r.tipo,
    nome: r.nome,
    produtor: r.produtor,
    status: r.status,
    orcamento: r.orcamento,
    prazo: r.prazo.toISOString().slice(0, 10),
    custoEstimado: r.custoEstimado,
    solicitacao: r.solicitacao,
    equipe: (r.equipe as MembroDTO[] | null) ?? null,
    metricas: (r.metricas as Record<string, number> | null) ?? null,
    resultados: r.resultados,
    criadoEm: r.criadoEm.toISOString(),
    atualizadoEm: r.atualizadoEm.toISOString(),
    finalizadoEm: r.finalizadoEm?.toISOString() ?? null,
  };
}
