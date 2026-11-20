import { EVENTOS_RECOMENDACAO as E, type DadosConvite, type Evento, type ObservadorEventos } from '@cinebridge/comum';
import type { Expedicao } from '../Expedicao';

/**
 * Entrega os convites aos profissionais. O texto já vem pronto da api, onde o notificador da família do projeto
 * (Abstract Factory da AV2) acrescenta os detalhes do tipo: técnica da animação, tema do documentário...
 */
export class EntregadorConvites implements ObservadorEventos {
  readonly tipos = [E.conviteEnviado];

  constructor(private readonly expedicao: Expedicao) {}

  async atualizar(evento: Evento): Promise<void> {
    const convite = evento.dados as DadosConvite & { projetoId?: string };
    await this.expedicao.expedir([
      {
        eventoId: evento.id,
        tipoEvento: evento.tipo,
        origem: evento.origem,
        projetoId: convite.projetoId ?? null,
        canal: 'email',
        destinatario: convite.para,
        assunto: convite.assunto,
        conteudo: convite.corpo,
      },
    ]);
  }
}
