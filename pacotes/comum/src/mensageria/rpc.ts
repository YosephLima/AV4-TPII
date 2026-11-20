import { randomUUID } from 'node:crypto';
import type { MensagemRecebida, Transporte } from './Transporte';

export interface PedidoRpc {
  operacao: string;
  dados?: unknown;
}

export type RespostaRpc = { ok: true; dados: unknown } | { ok: false; erro: { codigo: string; mensagem: string } };

/**
 * Erro de negócio que atravessa a fila: o tratador lança no serviço que responde e o cliente recebe o mesmo
 * código do outro lado, para decidir o que fazer (um 404, um 409...).
 */
export class ErroOperacao extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroOperacao';
  }
}

export class TempoEsgotadoError extends Error {
  constructor(fila: string, operacao: string, ms: number) {
    super(`Sem resposta de ${fila} (${operacao}) em ${ms} ms`);
    this.name = 'TempoEsgotadoError';
  }
}

interface Pendente {
  resolver: (dados: unknown) => void;
  rejeitar: (erro: Error) => void;
  temporizador: NodeJS.Timeout;
}

/**
 * Lado de quem pergunta. Uma única fila de respostas, exclusiva deste processo, recebe as respostas de todos os
 * pedidos; o correlationId diz a qual pedido cada resposta pertence. É a forma que a documentação do RabbitMQ
 * recomenda, e evita criar e apagar uma fila a cada consulta.
 */
export class ClienteRpc {
  private filaRespostas: string | undefined;
  private readonly pendentes = new Map<string, Pendente>();

  constructor(
    private readonly transporte: Transporte,
    readonly tempoLimiteMs = 5000,
  ) {}

  async iniciar(): Promise<this> {
    this.filaRespostas = await this.transporte.declararFilaExclusiva();
    await this.transporte.consumir(this.filaRespostas, async (mensagem) => this.receber(mensagem), {
      semConfirmacao: true,
    });
    return this;
  }

  chamar<T>(fila: string, operacao: string, dados?: unknown): Promise<T> {
    const replyTo = this.filaRespostas;
    if (!replyTo) return Promise.reject(new Error('ClienteRpc não iniciado'));

    const correlationId = randomUUID();
    return new Promise<T>((resolver, rejeitar) => {
      const temporizador = setTimeout(() => {
        this.pendentes.delete(correlationId);
        rejeitar(new TempoEsgotadoError(fila, operacao, this.tempoLimiteMs));
      }, this.tempoLimiteMs);
      this.pendentes.set(correlationId, { resolver: resolver as (dados: unknown) => void, rejeitar, temporizador });

      const pedido: PedidoRpc = { operacao, dados };
      // O pedido expira junto com a espera: ninguém processa um pedido que o cliente já abandonou.
      this.transporte
        .enviar(fila, pedido, { correlationId, replyTo, expiracao: this.tempoLimiteMs, type: operacao })
        .catch((erro: unknown) => this.encerrar(correlationId, erro instanceof Error ? erro : new Error(String(erro))));
    });
  }

  /** Uma resposta que chega depois do tempo limite não tem mais quem a espere e é ignorada. */
  private receber({ corpo, propriedades }: MensagemRecebida): void {
    const id = propriedades.correlationId;
    if (!id || !this.pendentes.has(id)) return;
    const resposta = corpo as RespostaRpc;
    if (resposta.ok) this.encerrar(id, undefined, resposta.dados);
    else this.encerrar(id, new ErroOperacao(resposta.erro.codigo, resposta.erro.mensagem));
  }

  private encerrar(id: string, erro?: Error, dados?: unknown): void {
    const pendente = this.pendentes.get(id);
    if (!pendente) return;
    clearTimeout(pendente.temporizador);
    this.pendentes.delete(id);
    if (erro) pendente.rejeitar(erro);
    else pendente.resolver(dados);
  }
}

export type TratadoresRpc = Record<string, (dados: never) => Promise<unknown>>;

/** Lado de quem responde: consome a fila durável e devolve cada resposta na fila indicada pelo pedido. */
export class ServidorRpc {
  constructor(
    private readonly transporte: Transporte,
    readonly fila: string,
    private readonly tratadores: TratadoresRpc,
    private readonly log: (mensagem: string) => void = (mensagem) => console.error(mensagem),
  ) {}

  async iniciar(): Promise<void> {
    await this.transporte.declararFila(this.fila);
    await this.transporte.consumir(this.fila, (mensagem) => this.atender(mensagem));
  }

  private async atender({ corpo, propriedades }: MensagemRecebida): Promise<void> {
    const { replyTo, correlationId } = propriedades;
    // Sem fila de resposta não há a quem responder: o erro manda o pedido para as descartadas.
    if (!replyTo) throw new Error('Pedido sem replyTo');
    const resposta = await this.responder(corpo as PedidoRpc);
    await this.transporte.enviar(replyTo, resposta, { correlationId });
  }

  async responder(pedido: PedidoRpc): Promise<RespostaRpc> {
    const tratar = this.tratadores[pedido?.operacao] as ((dados: unknown) => Promise<unknown>) | undefined;
    if (!tratar) {
      return { ok: false, erro: { codigo: 'OPERACAO_DESCONHECIDA', mensagem: `Operação desconhecida: ${pedido?.operacao}` } };
    }
    try {
      return { ok: true, dados: (await tratar(pedido.dados)) ?? null };
    } catch (erro) {
      if (erro instanceof ErroOperacao) return { ok: false, erro: { codigo: erro.codigo, mensagem: erro.message } };
      this.log(`Falha em ${this.fila} (${pedido.operacao}): ${erro instanceof Error ? erro.stack : String(erro)}`);
      return { ok: false, erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno no serviço' } };
    }
  }
}
