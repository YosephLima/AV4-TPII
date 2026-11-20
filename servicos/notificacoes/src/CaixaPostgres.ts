import type { PrismaClient } from '../generated/prisma/client';
import type { Caixa, FiltroNotificacoes, Notificacao, NotificacaoGuardada } from './Caixa';

type ClientePrisma = Pick<PrismaClient, 'notificacao' | '$queryRaw'>;

export class CaixaPostgres implements Caixa {
  constructor(private readonly prisma: ClientePrisma) {}

  async guardar(notificacoes: Notificacao[]): Promise<Notificacao[]> {
    const novas: Notificacao[] = [];
    for (const n of notificacoes) {
      // createMany com skipDuplicates não diz quais entraram; uma a uma, sabemos o que enviar de verdade.
      const { count } = await this.prisma.notificacao.createMany({ data: [n], skipDuplicates: true });
      if (count > 0) novas.push(n);
    }
    return novas;
  }

  async listar({ destinatario, projetoId, canal, limite = 100 }: FiltroNotificacoes = {}): Promise<NotificacaoGuardada[]> {
    const registros = await this.prisma.notificacao.findMany({
      where: { destinatario, projetoId, canal },
      orderBy: { id: 'desc' },
      take: limite,
    });
    return registros.map(({ id: _id, criadoEm, ...n }) => ({ ...n, criadoEm: criadoEm.toISOString() }));
  }

  async verificar(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}
