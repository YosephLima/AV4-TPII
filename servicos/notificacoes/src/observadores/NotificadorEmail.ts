import { EVENTOS_RECOMENDACAO as E, type DadosEventoRecomendacao, type Evento, type ObservadorEventos } from '@cinebridge/comum';
import type { Notificacao } from '../Caixa';
import type { Expedicao } from '../Expedicao';

/** Avisos por e-mail ao produtor: respostas aos convites e equipe formada. Veio da api na AV4. */
export class NotificadorEmail implements ObservadorEventos {
  readonly tipos = [E.conviteAceito, E.conviteRecusado, E.equipeFormada];

  constructor(private readonly expedicao: Expedicao) {}

  async atualizar(evento: Evento): Promise<void> {
    const { projetoId, projetoNome, produtor, envolvidos } = evento.dados as DadosEventoRecomendacao;
    const email = (assunto: string, conteudo: string): Notificacao => ({
      eventoId: evento.id,
      tipoEvento: evento.tipo,
      origem: evento.origem,
      projetoId,
      canal: 'email',
      destinatario: produtor,
      assunto,
      conteudo,
    });

    if (evento.tipo === E.equipeFormada) {
      await this.expedicao.expedir([email(`Equipe formada: ${projetoNome}`, 'Todos confirmaram.')]);
      return;
    }
    const resposta = evento.tipo === E.conviteAceito ? 'aceitou' : 'recusou';
    const linhas = envolvidos.map((e) => `${e.nome} ${resposta} o convite para ${e.papel}.`);
    await this.expedicao.expedir([email(`Resposta ao convite: ${projetoNome}`, linhas.join('\n'))]);
  }
}
