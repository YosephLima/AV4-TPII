import { profissionaisDeDemonstracao } from '@cinebridge/comum';
import type { Papel, PrismaClient } from '../generated/prisma/client';

/** Só cria quem ainda não existe, então pode rodar a cada partida do container. Devolve quantos criou. */
export async function semear(prisma: PrismaClient): Promise<number> {
  const existentes = new Set((await prisma.profissional.findMany({ select: { id: true } })).map((p) => p.id));
  let criados = 0;
  for (const p of profissionaisDeDemonstracao()) {
    if (existentes.has(p.id)) continue;
    await prisma.profissional.create({
      data: {
        id: p.id,
        nome: p.nome,
        especialidades: p.especialidades as Papel[],
        precoMedio: p.precoMedio,
        disponivelDe: new Date(p.disponibilidade.inicio),
        disponivelAte: new Date(p.disponibilidade.fim),
        localizacao: p.localizacao,
        projetosAnteriores: p.projetosAnteriores,
        competencias: { create: p.competencias },
        avaliacoes: {
          create: p.avaliacoes.map((a) => ({ nota: a.nota, comentario: a.comentario, data: new Date(a.data) })),
        },
      },
    });
    criados++;
  }
  return criados;
}
