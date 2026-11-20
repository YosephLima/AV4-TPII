import { ConsumidorEventos, FILAS, type Transporte } from '@cinebridge/comum';
import type { Caixa } from './Caixa';
import { Expedicao } from './Expedicao';
import { EntregadorConvites } from './observadores/EntregadorConvites';
import { NotificadorEmail } from './observadores/NotificadorEmail';
import { NotificadorInterno } from './observadores/NotificadorInterno';
import { NotificadorProjetos } from './observadores/NotificadorProjetos';

/**
 * Observer: um consumidor (sujeito) por fila, com os observadores inscritos. Cada observador declara os tipos de
 * evento que lhe interessam; um tipo novo de alerta é mais um observador aqui.
 */
export async function iniciarConsumidores(transporte: Transporte, caixa: Caixa, expedicao = new Expedicao(caixa)) {
  const recomendacao = await new ConsumidorEventos(transporte, FILAS.eventosRecomendacao)
    .inscrever(new NotificadorEmail(expedicao), new NotificadorInterno(expedicao), new EntregadorConvites(expedicao))
    .iniciar();
  const projetos = await new ConsumidorEventos(transporte, FILAS.eventosProjetos)
    .inscrever(new NotificadorProjetos(expedicao))
    .iniciar();
  return { recomendacao, projetos };
}
