import {
  ErroOperacao,
  EVENTOS_PROJETO,
  PROJETO_NAO_ENCONTRADO,
  TRANSICAO_INVALIDA,
  type DadosEventoProjeto,
  type Finalizacao,
  type MembroDTO,
  type ProjetoDTO,
  type RegistroProjeto,
  type StatusProjeto,
} from '@cinebridge/comum';
import type { FiltroProjetos, RepositorioProjetos } from './Repositorio';

export type PublicarEvento = (tipo: string, dados: DadosEventoProjeto) => Promise<unknown>;

const naoEncontrado = (id: string) => new ErroOperacao(PROJETO_NAO_ENCONTRADO, `Projeto não encontrado: ${id}`);
const transicaoInvalida = (projeto: ProjetoDTO, acao: string) =>
  new ErroOperacao(TRANSICAO_INVALIDA, `Não é possível ${acao}: o projeto ${projeto.nome} está ${projeto.status}`);

/**
 * O ciclo de vida do projeto. Cada mudança é gravada no projetos-db e só então publicada em eventos-projetos,
 * de onde o serviço de notificações dispara os alertas.
 */
export class GestaoProjetos {
  constructor(
    private readonly repositorio: RepositorioProjetos,
    private readonly publicar: PublicarEvento,
  ) {}

  /** Idempotente: registrar de novo o mesmo id atualiza os dados em vez de duplicar o projeto. */
  async registrar(registro: RegistroProjeto): Promise<ProjetoDTO> {
    const existente = await this.repositorio.buscar(registro.id);
    if (!existente) {
      const novo = await this.repositorio.salvar({
        ...registro,
        status: 'em_formacao',
        equipe: null,
        metricas: null,
        resultados: null,
        criadoEm: '',
        atualizadoEm: '',
        finalizadoEm: null,
      });
      return this.anunciar(EVENTOS_PROJETO.criado, novo);
    }
    if (existente.status === 'finalizado') throw transicaoInvalida(existente, 'alterar os dados');
    return this.anunciar(EVENTOS_PROJETO.atualizado, await this.repositorio.salvar({ ...existente, ...registro }), 'dados');
  }

  async buscar(id: string): Promise<ProjetoDTO> {
    const projeto = await this.repositorio.buscar(id);
    if (!projeto) throw naoEncontrado(id);
    return projeto;
  }

  listar(filtro?: FiltroProjetos): Promise<ProjetoDTO[]> {
    return this.repositorio.listar(filtro);
  }

  /** Todos aceitaram os convites: guarda a composição final. Repetir com a equipe já formada não muda nada. */
  async formarEquipe(id: string, equipe: MembroDTO[]): Promise<ProjetoDTO> {
    const projeto = await this.buscar(id);
    if (projeto.status === 'equipe_formada') return projeto;
    this.exigir(projeto, 'em_formacao', 'formar a equipe');
    const salvo = await this.repositorio.salvar({ ...projeto, status: 'equipe_formada', equipe });
    return this.anunciar(EVENTOS_PROJETO.atualizado, salvo, 'equipe_formada');
  }

  /** Reavaliação: o projeto volta a em_formacao, sem equipe, possivelmente com novo orçamento ou prazo. */
  async reabrir(id: string, alteracoes: Partial<RegistroProjeto> = {}): Promise<ProjetoDTO> {
    const projeto = await this.buscar(id);
    if (projeto.status === 'finalizado') throw transicaoInvalida(projeto, 'reavaliar a equipe');
    const salvo = await this.repositorio.salvar({ ...projeto, ...alteracoes, id, status: 'em_formacao', equipe: null });
    return this.anunciar(EVENTOS_PROJETO.atualizado, salvo, 'reavaliacao');
  }

  /** Fim da produção, informado pelo produtor, com as métricas e os resultados do projeto. */
  async finalizar(id: string, { metricas, resultados }: Finalizacao = {}): Promise<ProjetoDTO> {
    const projeto = await this.buscar(id);
    this.exigir(projeto, 'equipe_formada', 'finalizar');
    const salvo = await this.repositorio.salvar({
      ...projeto,
      status: 'finalizado',
      metricas: metricas ?? null,
      resultados: resultados ?? null,
      finalizadoEm: new Date().toISOString(),
    });
    return this.anunciar(EVENTOS_PROJETO.finalizado, salvo);
  }

  verificar(): Promise<void> {
    return this.repositorio.verificar();
  }

  private exigir(projeto: ProjetoDTO, status: StatusProjeto, acao: string): void {
    if (projeto.status !== status) throw transicaoInvalida(projeto, acao);
  }

  private async anunciar(tipo: string, projeto: ProjetoDTO, motivo?: string): Promise<ProjetoDTO> {
    const { solicitacao: _solicitacao, ...resumo } = projeto;
    await this.publicar(tipo, motivo ? { projeto: resumo, motivo } : { projeto: resumo });
    return projeto;
  }
}
