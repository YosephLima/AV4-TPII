/** O que viaja junto com o corpo da mensagem. */
export interface Propriedades {
  /** Liga a resposta de um RPC ao pedido que a originou. */
  correlationId?: string;
  /** Fila onde quem pediu espera a resposta. */
  replyTo?: string;
  messageId?: string;
  type?: string;
  /** Em milissegundos. Se ninguém consumir antes, a mensagem expira. */
  expiracao?: number;
}

export interface MensagemRecebida {
  corpo: unknown;
  propriedades: Propriedades;
}

export type Tratador = (mensagem: MensagemRecebida) => Promise<void>;

export interface OpcoesConsumo {
  /** Para filas de resposta temporárias, em que perder uma mensagem só faz o pedido expirar. */
  semConfirmacao?: boolean;
}

/** Sufixo da fila que recebe as mensagens recusadas ou expiradas de cada fila (dead letter queue). */
export const SUFIXO_DESCARTADAS = '.descartadas';

/**
 * O mínimo que os serviços precisam do broker. Há uma implementação com o RabbitMQ e outra em memória, que os
 * testes usam no lugar dele.
 */
export interface Transporte {
  /** Fila durável, com a sua fila de descartadas. Declarar de novo uma fila que já existe não muda nada. */
  declararFila(fila: string): Promise<void>;
  /** Fila exclusiva desta conexão, com nome gerado pelo broker. Some quando a conexão fecha. */
  declararFilaExclusiva(): Promise<string>;
  /** Mensagem persistente; só resolve depois que o broker confirma o recebimento. */
  enviar(fila: string, corpo: unknown, propriedades?: Propriedades): Promise<void>;
  /**
   * Confirma (ack) a mensagem quando o tratador termina. Se ele falhar, recusa a mensagem sem devolvê-la à fila,
   * e ela vai para a fila de descartadas, em vez de voltar sem fim.
   */
  consumir(fila: string, tratar: Tratador, opcoes?: OpcoesConsumo): Promise<void>;
  conectado(): boolean;
  fechar(): Promise<void>;
}
