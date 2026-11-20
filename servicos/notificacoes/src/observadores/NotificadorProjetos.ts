import {
  EVENTOS_PROJETO as P,
  type DadosEventoProjeto,
  type Evento,
  type ObservadorEventos,
  type ResumoProjeto,
} from '@cinebridge/comum';
import type { Expedicao } from '../Expedicao';

const MOTIVOS: Record<string, string> = {
  dados: 'Os dados do projeto foram atualizados.',
  equipe_formada: 'A composição final da equipe foi registrada.',
  reavaliacao: 'O projeto voltou à formação de equipe, para reavaliação.',
};

/** Alertas ao produtor sobre o ciclo de vida do projeto, a partir da fila eventos-projetos. */
export class NotificadorProjetos implements ObservadorEventos {
  readonly tipos = [P.criado, P.atualizado, P.finalizado];

  constructor(private readonly expedicao: Expedicao) {}

  async atualizar(evento: Evento): Promise<void> {
    const { projeto, motivo } = evento.dados as DadosEventoProjeto;
    const [assunto, conteudo] = this.texto(evento.tipo, projeto, motivo);
    await this.expedicao.expedir([
      {
        eventoId: evento.id,
        tipoEvento: evento.tipo,
        origem: evento.origem,
        projetoId: projeto.id,
        canal: 'email',
        destinatario: projeto.produtor,
        assunto,
        conteudo,
      },
    ]);
  }

  private texto(tipo: string, projeto: ResumoProjeto, motivo?: string): [string, string] {
    switch (tipo) {
      case P.criado:
        return [`Projeto registrado: ${projeto.nome}`, `Entrega prevista para ${projeto.prazo}.`];
      case P.finalizado: {
        const metricas = Object.entries(projeto.metricas ?? {}).map(([nome, valor]) => `${nome}: ${valor}`);
        const resultados = [projeto.resultados, ...metricas].filter(Boolean).join('\n');
        return [`Projeto finalizado: ${projeto.nome}`, resultados || 'Produção encerrada.'];
      }
      default:
        return [`Projeto atualizado: ${projeto.nome}`, MOTIVOS[motivo ?? ''] ?? `Situação: ${projeto.status}.`];
    }
  }
}
