import { randomUUID } from 'node:crypto';
import {
  SUFIXO_DESCARTADAS,
  type MensagemRecebida,
  type OpcoesConsumo,
  type Propriedades,
  type Tratador,
  type Transporte,
} from './Transporte';

interface Fila {
  pendentes: MensagemRecebida[];
  consumidor?: { tratar: Tratador; semConfirmacao: boolean };
}

/**
 * Broker em memória, com o mesmo comportamento que importa do RabbitMQ: mensagem para fila inexistente se perde,
 * fila sem consumidor acumula, tratador com erro manda a mensagem para as descartadas. Serve aos testes de
 * todos os serviços, que assim não precisam de um broker de verdade.
 */
export class TransporteMemoria implements Transporte {
  private readonly filas = new Map<string, Fila>();
  private readonly emAndamento = new Set<Promise<void>>();
  private ativo = true;

  async declararFila(fila: string): Promise<void> {
    this.criar(fila + SUFIXO_DESCARTADAS);
    this.criar(fila);
  }

  async declararFilaExclusiva(): Promise<string> {
    const nome = `amq.gen-${randomUUID()}`;
    this.criar(nome);
    return nome;
  }

  async enviar(fila: string, corpo: unknown, propriedades: Propriedades = {}): Promise<void> {
    if (!this.ativo) throw new Error('Transporte fechado');
    const destino = this.filas.get(fila);
    if (!destino) return;
    // A cópia via JSON imita a serialização da rede: quem recebe nunca compartilha objetos com quem enviou.
    const mensagem = { corpo: JSON.parse(JSON.stringify(corpo)) as unknown, propriedades: { ...propriedades } };
    destino.pendentes.push(mensagem);
    this.despachar(fila);
  }

  async consumir(fila: string, tratar: Tratador, opcoes: OpcoesConsumo = {}): Promise<void> {
    const destino = this.filas.get(fila);
    if (!destino) throw new Error(`Fila inexistente: ${fila}`);
    destino.consumidor = { tratar, semConfirmacao: opcoes.semConfirmacao ?? false };
    this.despachar(fila);
  }

  conectado(): boolean {
    return this.ativo;
  }

  async fechar(): Promise<void> {
    this.ativo = false;
  }

  /** Mensagens que ainda esperam consumidor. */
  pendentes(fila: string): MensagemRecebida[] {
    return [...(this.filas.get(fila)?.pendentes ?? [])];
  }

  descartadas(fila: string): MensagemRecebida[] {
    return this.pendentes(fila + SUFIXO_DESCARTADAS);
  }

  /** Espera todas as entregas, inclusive as que outras entregas provocarem. */
  async ocioso(): Promise<void> {
    while (this.emAndamento.size > 0) await Promise.all(this.emAndamento);
  }

  private criar(fila: string): void {
    if (!this.filas.has(fila)) this.filas.set(fila, { pendentes: [] });
  }

  private despachar(fila: string): void {
    const destino = this.filas.get(fila);
    const consumidor = destino?.consumidor;
    if (!destino || !consumidor) return;

    for (const mensagem of destino.pendentes.splice(0)) {
      const entrega = (async () => {
        // Entrega assíncrona, como no broker: quem enviou segue antes de o consumidor processar.
        await Promise.resolve();
        try {
          await consumidor.tratar(mensagem);
        } catch {
          if (consumidor.semConfirmacao) return;
          const descartadas = this.filas.get(fila + SUFIXO_DESCARTADAS);
          descartadas?.pendentes.push(mensagem);
        }
      })();
      this.emAndamento.add(entrega);
      void entrega.finally(() => this.emAndamento.delete(entrega));
    }
  }
}
