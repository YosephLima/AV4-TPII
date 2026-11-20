import { EVENTOS_RECOMENDACAO as E, type DadosEventoRecomendacao, type Evento, type ObservadorEventos } from '@cinebridge/comum';
import type { Notificacao } from '../Caixa';
import type { Expedicao } from '../Expedicao';

/** Mensagens internas da plataforma para cada profissional envolvido e para o produtor. Veio da api na AV4. */
export class NotificadorInterno implements ObservadorEventos {
  readonly tipos = [
    E.recomendacaoGerada,
    E.membroSubstituido,
    E.conviteAceito,
    E.conviteRecusado,
    E.reavaliacaoSolicitada,
    E.equipeFormada,
  ];

  constructor(private readonly expedicao: Expedicao) {}

  async atualizar(evento: Evento): Promise<void> {
    const { projetoId, projetoNome, produtor, envolvidos } = evento.dados as DadosEventoRecomendacao;
    const mensagem = (destinatario: string, conteudo: string): Notificacao => ({
      eventoId: evento.id,
      tipoEvento: evento.tipo,
      origem: evento.origem,
      projetoId,
      canal: 'interna',
      destinatario,
      assunto: `[${evento.tipo}] ${projetoNome}`,
      conteudo,
    });

    await this.expedicao.expedir([
      ...envolvidos.map((e) => mensagem(e.profissionalId, `${projetoNome}: ${e.papel}`)),
      mensagem(produtor, `${projetoNome}: ${envolvidos.length} profissional(is) envolvido(s)`),
    ]);
  }
}
