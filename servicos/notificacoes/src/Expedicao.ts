import type { Caixa, Notificacao } from './Caixa';

/**
 * Registra e envia. O envio é simulado (uma linha no log), como os provedores externos da AV3; trocar por um
 * SMTP de verdade mexeria só aqui.
 */
export class Expedicao {
  constructor(
    private readonly caixa: Caixa,
    private readonly enviar: (n: Notificacao) => void = (n) =>
      console.log(`[${n.canal}] para ${n.destinatario}: ${n.assunto}`),
  ) {}

  async expedir(notificacoes: Notificacao[]): Promise<void> {
    for (const nova of await this.caixa.guardar(notificacoes)) this.enviar(nova);
  }
}
