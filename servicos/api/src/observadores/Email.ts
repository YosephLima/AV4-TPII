export interface Email {
  para: string;
  assunto: string;
  corpo: string;
  /** Para o serviço de notificações agrupar os envios por projeto. */
  projetoId?: string;
}

/**
 * Como os convites saem da api. Rodando com o broker, a mensagem vai para a fila eventos-recomendacao e quem
 * envia de fato é o serviço de notificações; sem o broker, vai para o console.
 */
export type EnviarEmail = (email: Email) => void;

export const enviarPorConsole: EnviarEmail = (e) => console.log(`[email] ${e.para}: ${e.assunto}`);
