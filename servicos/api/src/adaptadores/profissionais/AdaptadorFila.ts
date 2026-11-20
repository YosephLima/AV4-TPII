import {
  ErroOperacao,
  FILAS,
  OPERACOES_PROFISSIONAIS as OP,
  PROFISSIONAL_NAO_ENCONTRADO,
  type ClienteRpc,
  type ProfissionalDTO,
} from '@cinebridge/comum';
import type { Avaliacao } from '../../dominio/Avaliacao';
import type { Profissional } from '../../dominio/Profissional';
import { profissionalDoDTO } from '../../mapeamento/profissionais';
import { ProfissionalNaoEncontradoError, type AdaptadorProfissional, type CriteriosBusca } from './AdaptadorProfissional';

/**
 * O serviço cinebridge-profissionais visto pela interface da AV3: cada método vira um pedido na fila
 * consulta-profissionais, e a resposta é traduzida para o domínio. O orquestrador não sabe que há uma fila.
 */
export class AdaptadorFila implements AdaptadorProfissional {
  readonly provedor = 'fila';

  constructor(private readonly rpc: ClienteRpc) {}

  async listarProfissionais(criterios: CriteriosBusca = {}): Promise<Profissional[]> {
    const lista = await this.rpc.chamar<ProfissionalDTO[]>(FILAS.consultaProfissionais, OP.listar, criterios);
    return lista.map(profissionalDoDTO);
  }

  async detalharProfissional(id: string): Promise<Profissional> {
    const dto = await traduzirNaoEncontrado(id, this.rpc.chamar<ProfissionalDTO>(FILAS.consultaProfissionais, OP.detalhar, { id }));
    return profissionalDoDTO(dto);
  }

  async registrarAvaliacao(id: string, avaliacao: Avaliacao): Promise<void> {
    const dados = { nota: avaliacao.nota, comentario: avaliacao.comentario, data: avaliacao.data.toISOString() };
    await traduzirNaoEncontrado(id, this.rpc.chamar(FILAS.consultaProfissionais, OP.avaliar, { profissionalId: id, avaliacao: dados }));
  }
}

/** O código de erro que veio pela fila vira o mesmo erro que os outros adaptadores lançam. */
async function traduzirNaoEncontrado<T>(id: string, chamada: Promise<T>): Promise<T> {
  try {
    return await chamada;
  } catch (erro) {
    if (erro instanceof ErroOperacao && erro.codigo === PROFISSIONAL_NAO_ENCONTRADO) throw new ProfissionalNaoEncontradoError(id);
    throw erro;
  }
}
