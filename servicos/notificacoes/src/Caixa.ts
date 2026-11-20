export type Canal = 'email' | 'interna';

export interface Notificacao {
  eventoId: string;
  tipoEvento: string;
  origem: string;
  projetoId: string | null;
  canal: Canal;
  destinatario: string;
  assunto: string;
  conteudo: string;
}

export interface NotificacaoGuardada extends Notificacao {
  criadoEm: string;
}

export interface FiltroNotificacoes {
  destinatario?: string;
  projetoId?: string;
  canal?: Canal;
  limite?: number;
}

/** As notificações já enviadas, no notificacoes-db. */
export interface Caixa {
  /** Devolve só as que ainda não existiam: um evento reentregue não gera alerta repetido. */
  guardar(notificacoes: Notificacao[]): Promise<Notificacao[]>;
  /** Mais recentes primeiro. */
  listar(filtro?: FiltroNotificacoes): Promise<NotificacaoGuardada[]>;
  verificar(): Promise<void>;
}

const chave = (n: Notificacao) => `${n.eventoId}|${n.canal}|${n.destinatario}`;

export class CaixaEmMemoria implements Caixa {
  private readonly guardadas: NotificacaoGuardada[] = [];

  async guardar(notificacoes: Notificacao[]): Promise<Notificacao[]> {
    const existentes = new Set(this.guardadas.map(chave));
    const novas = notificacoes.filter((n) => !existentes.has(chave(n)));
    this.guardadas.push(...novas.map((n) => ({ ...n, criadoEm: new Date().toISOString() })));
    return novas;
  }

  async listar({ destinatario, projetoId, canal, limite = 100 }: FiltroNotificacoes = {}): Promise<NotificacaoGuardada[]> {
    return this.guardadas
      .filter(
        (n) =>
          (!destinatario || n.destinatario === destinatario) &&
          (!projetoId || n.projetoId === projetoId) &&
          (!canal || n.canal === canal),
      )
      .reverse()
      .slice(0, limite);
  }

  async verificar(): Promise<void> {}
}
