import { randomUUID } from 'node:crypto';
import type { Transporte } from './Transporte';

/** Envelope comum a todos os eventos que circulam entre os serviços. */
export interface Evento<D = unknown> {
  /** Único por evento; quem consome usa para não processar o mesmo evento duas vezes. */
  id: string;
  tipo: string;
  /** Serviço que publicou. */
  origem: string;
  ocorridoEm: string;
  dados: D;
}

export class PublicadorEventos {
  constructor(
    private readonly transporte: Transporte,
    readonly fila: string,
    private readonly origem: string,
  ) {}

  async iniciar(): Promise<this> {
    await this.transporte.declararFila(this.fila);
    return this;
  }

  async publicar<D>(tipo: string, dados: D): Promise<Evento<D>> {
    const evento: Evento<D> = { id: randomUUID(), tipo, origem: this.origem, ocorridoEm: new Date().toISOString(), dados };
    await this.transporte.enviar(this.fila, evento, { messageId: evento.id, type: tipo });
    return evento;
  }
}

/** Observer do lado de quem consome: cada observador recebe os eventos dos tipos que declarou. */
export interface ObservadorEventos {
  /** Sem a lista, recebe todos. */
  readonly tipos?: readonly string[];
  atualizar(evento: Evento): Promise<void> | void;
}

export class EventoInvalidoError extends Error {
  constructor() {
    super('Mensagem fora do formato de evento');
    this.name = 'EventoInvalidoError';
  }
}

/**
 * Sujeito do Observer: consome a fila e repassa cada evento aos observadores inscritos. Se algum observador
 * falhar, a mensagem é recusada e vai para a fila de descartadas, onde fica visível no painel do RabbitMQ.
 */
export class ConsumidorEventos {
  private readonly observadores: ObservadorEventos[] = [];

  constructor(
    private readonly transporte: Transporte,
    readonly fila: string,
  ) {}

  inscrever(...observadores: ObservadorEventos[]): this {
    this.observadores.push(...observadores);
    return this;
  }

  async iniciar(): Promise<this> {
    await this.transporte.declararFila(this.fila);
    await this.transporte.consumir(this.fila, async ({ corpo }) => this.notificar(eventoValido(corpo)));
    return this;
  }

  /** Todos os interessados recebem o evento, mesmo que um deles falhe antes. */
  async notificar(evento: Evento): Promise<void> {
    const interessados = this.observadores.filter((o) => !o.tipos || o.tipos.includes(evento.tipo));
    const resultados = await Promise.allSettled(interessados.map(async (o) => o.atualizar(evento)));
    const falhas = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (falhas.length > 0) {
      throw new AggregateError(
        falhas.map((f) => f.reason),
        `${falhas.length} observador(es) falharam ao tratar ${evento.tipo}`,
      );
    }
  }
}

function eventoValido(corpo: unknown): Evento {
  const evento = corpo as Partial<Evento> | null;
  if (!evento || typeof evento.id !== 'string' || typeof evento.tipo !== 'string' || !('dados' in evento)) {
    throw new EventoInvalidoError();
  }
  return evento as Evento;
}
