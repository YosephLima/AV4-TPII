import type { DadosEventoRecomendacao, PublicadorEventos } from '@cinebridge/comum';
import { BarramentoEmMemoria, type BarramentoEventos } from './BarramentoEventos';
import type { EventoRecomendacao } from './EventoRecomendacao';

/**
 * A troca que o comentário do BarramentoEventos previa desde a AV1: cada evento vai para a fila
 * eventos-recomendacao, de onde o serviço de notificações dispara os alertas. Os observadores que continuam na
 * api (a auditoria) seguem recebendo em memória. O SistemaRecomendacao não mudou para isso.
 */
export class BarramentoRabbitMQ implements BarramentoEventos {
  private readonly local = new BarramentoEmMemoria();

  constructor(
    private readonly publicador: PublicadorEventos,
    private readonly aoFalhar: (erro: unknown) => void = (erro) => console.error('Falha ao publicar evento:', erro),
  ) {}

  publicar(evento: EventoRecomendacao): void {
    this.local.publicar(evento);
    const dados: DadosEventoRecomendacao = { ...evento.dados, tipoProjeto: evento.projeto.tipo };
    // A interface é síncrona; a confirmação do broker chega depois e uma falha só pode ser registrada.
    this.publicador.publicar(evento.tipo, dados).catch(this.aoFalhar);
  }

  inscrever(ouvinte: (evento: EventoRecomendacao) => void): void {
    this.local.inscrever(ouvinte);
  }
}
