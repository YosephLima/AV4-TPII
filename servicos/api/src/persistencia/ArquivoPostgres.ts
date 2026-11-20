import { ArquivoNaoEncontradoError } from '../adaptadores/armazenamento/AdaptadorArmazenamento';
import type { Arquivo } from '../contratacao/ArquivoRecomendacoes';
import { equipeDoEstado, registroDe, type EstadoEquipe, type RecomendacaoArquivada } from '../contratacao/estadoEquipe';
import type { Equipe, StatusEquipe } from '../dominio/Equipe';
import type { Projeto } from '../dominio/Projeto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';

type ClientePrisma = Pick<PrismaClient, 'recomendacao' | 'rodada' | '$transaction' | '$queryRaw'>;

/** As recomendações no banco recomendacoes-db, com o histórico de cada mudança na equipe. */
export class ArquivoPostgres implements Arquivo {
  constructor(private readonly prisma: ClientePrisma) {}

  async guardar(projeto: Projeto, equipe: Equipe): Promise<void> {
    const { projetoId, nome, tipo, produtor, custoEstimado, status, equipe: resumo, estado } = registroDe(projeto, equipe);
    const dados = {
      nome,
      tipo,
      produtor,
      custoEstimado,
      status,
      equipe: resumo as unknown as Prisma.InputJsonValue,
      estado: estado as unknown as Prisma.InputJsonValue,
    };
    await this.prisma.$transaction([
      this.prisma.recomendacao.upsert({ where: { projetoId }, create: { projetoId, ...dados }, update: dados }),
      this.prisma.rodada.create({ data: { projetoId, equipeId: equipe.id, status, equipe: dados.equipe } }),
    ]);
  }

  async consultar(projetoId: string): Promise<RecomendacaoArquivada> {
    const r = await this.prisma.recomendacao.findUnique({ where: { projetoId } });
    if (!r) throw new ArquivoNaoEncontradoError(projetoId);
    return {
      projetoId: r.projetoId,
      nome: r.nome,
      tipo: r.tipo,
      produtor: r.produtor,
      custoEstimado: r.custoEstimado,
      data: (r.estado as unknown as EstadoEquipe).dataFormacao,
      status: r.status as StatusEquipe,
      equipe: r.equipe as unknown as RecomendacaoArquivada['equipe'],
    };
  }

  async carregarEquipe(projetoId: string): Promise<Equipe | undefined> {
    const r = await this.prisma.recomendacao.findUnique({ where: { projetoId }, select: { estado: true } });
    return r ? equipeDoEstado(r.estado as unknown as EstadoEquipe) : undefined;
  }

  async verificar(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}
