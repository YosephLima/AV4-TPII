import {
  FILAS,
  OPERACOES_PROFISSIONAIS,
  ServidorRpc,
  type CriteriosProfissionais,
  type PedidoAvaliacao,
  type Transporte,
} from '@cinebridge/comum';
import type { Cadastro } from './Cadastro';

/** Atende a fila consulta-profissionais: cada operação do contrato vira uma chamada ao cadastro. */
export function servidorConsultas(transporte: Transporte, cadastro: Cadastro): ServidorRpc {
  return new ServidorRpc(transporte, FILAS.consultaProfissionais, {
    [OPERACOES_PROFISSIONAIS.listar]: (criterios: CriteriosProfissionais | null) => cadastro.listar(criterios ?? {}),
    [OPERACOES_PROFISSIONAIS.detalhar]: ({ id }: { id: string }) => cadastro.detalhar(id),
    [OPERACOES_PROFISSIONAIS.avaliar]: ({ profissionalId, avaliacao }: PedidoAvaliacao) =>
      cadastro.avaliar(profissionalId, avaliacao),
  });
}
