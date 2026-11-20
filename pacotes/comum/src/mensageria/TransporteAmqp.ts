import { connect, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import { SUFIXO_DESCARTADAS, type OpcoesConsumo, type Propriedades, type Tratador, type Transporte } from './Transporte';

export interface OpcoesAmqp {
  url: string;
  /** Tentativas de conexão na partida, enquanto o broker ainda está subindo. */
  tentativas?: number;
  intervaloMs?: number;
  /** Quantas mensagens cada consumidor processa ao mesmo tempo. */
  prefetch?: number;
  /**
   * Chamado se a conexão cair depois de estabelecida. O padrão encerra o processo, para o Docker reiniciar o
   * serviço (restart: unless-stopped) e ele voltar com conexão, filas e consumidores refeitos do zero.
   */
  aoPerderConexao?: (erro?: Error) => void;
  log?: (mensagem: string) => void;
}

const encerrarProcesso = (erro?: Error) => {
  console.error('Conexão com o RabbitMQ perdida; encerrando para o Docker reiniciar o serviço.', erro ?? '');
  process.exit(1);
};

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

export class TransporteAmqp implements Transporte {
  private ativo = true;
  private encerrando = false;

  private constructor(
    private readonly conexao: ChannelModel,
    private readonly canal: ConfirmChannel,
    private readonly log: (mensagem: string) => void,
    aoPerderConexao: (erro?: Error) => void,
  ) {
    const perder = (erro?: Error) => {
      if (!this.ativo) return;
      this.ativo = false;
      if (!this.encerrando) aoPerderConexao(erro);
    };
    conexao.on('error', (erro: Error) => this.log(`Erro na conexão com o RabbitMQ: ${erro.message}`));
    conexao.on('close', perder);
    canal.on('error', (erro: Error) => this.log(`Erro no canal do RabbitMQ: ${erro.message}`));
    canal.on('close', () => perder(new Error('Canal fechado')));
  }

  /** O RabbitMQ demora alguns segundos para aceitar conexões, então a primeira conexão tenta de novo. */
  static async conectar(opcoes: OpcoesAmqp): Promise<TransporteAmqp> {
    const { url, tentativas = 30, intervaloMs = 2000, prefetch = 10 } = opcoes;
    const log = opcoes.log ?? ((mensagem: string) => console.log(mensagem));

    for (let tentativa = 1; ; tentativa++) {
      try {
        const conexao = await connect(url);
        const canal = await conexao.createConfirmChannel();
        await canal.prefetch(prefetch);
        log(`Conectado ao RabbitMQ (tentativa ${tentativa})`);
        return new TransporteAmqp(conexao, canal, log, opcoes.aoPerderConexao ?? encerrarProcesso);
      } catch (erro) {
        if (tentativa >= tentativas) throw erro;
        log(`RabbitMQ indisponível (tentativa ${tentativa}/${tentativas}); nova tentativa em ${intervaloMs} ms`);
        await esperar(intervaloMs);
      }
    }
  }

  async declararFila(fila: string): Promise<void> {
    const descartadas = fila + SUFIXO_DESCARTADAS;
    await this.canal.assertQueue(descartadas, { durable: true });
    // Mensagens recusadas ou expiradas vão para a fila de descartadas, pela exchange padrão.
    await this.canal.assertQueue(fila, {
      durable: true,
      deadLetterExchange: '',
      deadLetterRoutingKey: descartadas,
    });
  }

  async declararFilaExclusiva(): Promise<string> {
    const { queue } = await this.canal.assertQueue('', { exclusive: true, autoDelete: true });
    return queue;
  }

  enviar(fila: string, corpo: unknown, propriedades: Propriedades = {}): Promise<void> {
    return new Promise((resolver, rejeitar) => {
      this.canal.sendToQueue(
        fila,
        Buffer.from(JSON.stringify(corpo)),
        {
          persistent: true,
          contentType: 'application/json',
          correlationId: propriedades.correlationId,
          replyTo: propriedades.replyTo,
          messageId: propriedades.messageId,
          type: propriedades.type,
          expiration: propriedades.expiracao === undefined ? undefined : String(propriedades.expiracao),
        },
        (erro) => (erro ? rejeitar(erro instanceof Error ? erro : new Error(String(erro))) : resolver()),
      );
    });
  }

  async consumir(fila: string, tratar: Tratador, opcoes: OpcoesConsumo = {}): Promise<void> {
    const semConfirmacao = opcoes.semConfirmacao ?? false;
    await this.canal.consume(
      fila,
      (mensagem) => {
        // null: o broker cancelou o consumidor (a fila foi apagada, por exemplo).
        if (mensagem === null) {
          this.log(`Consumidor da fila ${fila} cancelado pelo broker`);
          return;
        }
        void this.processar(fila, mensagem, tratar, semConfirmacao);
      },
      { noAck: semConfirmacao },
    );
  }

  conectado(): boolean {
    return this.ativo;
  }

  async fechar(): Promise<void> {
    this.encerrando = true;
    if (!this.ativo) return;
    await this.conexao.close();
  }

  private async processar(fila: string, mensagem: ConsumeMessage, tratar: Tratador, semConfirmacao: boolean) {
    try {
      const corpo: unknown = JSON.parse(mensagem.content.toString('utf8'));
      const { correlationId, replyTo, messageId, type } = mensagem.properties as Propriedades;
      await tratar({ corpo, propriedades: { correlationId, replyTo, messageId, type } });
      if (!semConfirmacao) this.canal.ack(mensagem);
    } catch (erro) {
      this.log(`Mensagem da fila ${fila} recusada: ${erro instanceof Error ? erro.message : String(erro)}`);
      if (!semConfirmacao && this.ativo) this.canal.nack(mensagem, false, false);
    }
  }
}
