import type { MembroDTO, ProjetoDTO, RegistroProjeto } from '@cinebridge/comum';
import type { Equipe } from '../dominio/Equipe';
import type { Papel } from '../dominio/Papel';
import type { Projeto } from '../dominio/Projeto';
import type { Projetos } from '../projetos/Projetos';
import type { SistemaRecomendacao } from '../SistemaRecomendacao';
import { solicitacaoDoCorpo, type CorpoRecomendacao } from './solicitacao';

/** O produtor tentou mexer na equipe de um projeto em que isso não cabe mais. */
export class OperacaoNaoPermitidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'OperacaoNaoPermitidaError';
  }
}

export class PapelForaDaEquipeError extends Error {
  constructor(papel: Papel) {
    super(`O projeto não tem convite para ${papel}`);
    this.name = 'PapelForaDaEquipeError';
  }
}

export interface AjustesReavaliacao {
  orcamento?: number;
  prazo?: string;
}

/**
 * O fluxo do produtor através dos serviços: o projeto vive no cinebridge-projetos (fonte de verdade), a equipe no
 * recomendacoes-db, e a cada requisição o projeto é recriado pela fábrica a partir do pedido original. A lógica
 * de recomendação continua toda no SistemaRecomendacao, que não sabe que existem outros serviços.
 */
export class FluxoProdutor {
  constructor(
    private readonly sistema: SistemaRecomendacao,
    private readonly projetos: Projetos,
  ) {}

  /** Recomenda e só então registra o projeto: um pedido recusado na validação não deixa projeto órfão. */
  async recomendar(corpo: CorpoRecomendacao): Promise<{ projeto: Projeto; equipe: Equipe }> {
    const resultado = await this.sistema.recomendar(solicitacaoDoCorpo(corpo));
    await this.projetos.registrar(registroDoProjeto(resultado.projeto, corpo));
    return resultado;
  }

  async responderConvite(projetoId: string, papel: Papel, aceito: boolean): Promise<Projeto> {
    const { projeto } = await this.carregar(projetoId, 'em_formacao');
    this.exigirConvite(projeto, papel);
    await this.sistema.responderConvite(projeto, papel, aceito);
    const equipe = projeto.equipe;
    // Com todos confirmados, a composição final vai para o serviço de projetos (previsto desde a AV1).
    if (equipe?.status === 'formada') await this.projetos.formarEquipe(projetoId, membros(equipe));
    return projeto;
  }

  async substituir(projetoId: string, papel: Papel): Promise<Projeto> {
    const { projeto } = await this.carregar(projetoId, 'em_formacao');
    this.exigirConvite(projeto, papel);
    await this.sistema.substituirMembro(projeto, papel);
    return projeto;
  }

  /** Mudança grande de orçamento ou prazo: refaz a equipe inteira, inclusive depois de formada. */
  async reavaliar(projetoId: string, ajustes: AjustesReavaliacao = {}): Promise<Projeto> {
    const { registro, projeto: atual } = await this.carregar(projetoId, 'em_formacao', 'equipe_formada');
    const corpo: CorpoRecomendacao = { ...(registro.solicitacao as CorpoRecomendacao) };
    if (ajustes.orcamento !== undefined) corpo.orcamento = ajustes.orcamento;
    if (ajustes.prazo !== undefined) corpo.prazo = ajustes.prazo;

    const projeto = this.sistema.criarProjeto(solicitacaoDoCorpo(corpo, projetoId));
    if (atual.equipe) projeto.definirEquipe(atual.equipe);
    await this.sistema.reavaliar(projeto);
    const { id: _id, ...alteracoes } = registroDoProjeto(projeto, corpo);
    await this.projetos.reabrir(projetoId, alteracoes);
    return projeto;
  }

  private async carregar(projetoId: string, ...permitidos: ProjetoDTO['status'][]) {
    const registro = await this.projetos.buscar(projetoId);
    if (!permitidos.includes(registro.status)) {
      const dica = registro.status === 'equipe_formada' ? '; para mudar a equipe, peça uma reavaliação' : '';
      throw new OperacaoNaoPermitidaError(`O projeto ${registro.nome} está ${registro.status}${dica}`);
    }
    const projeto = this.sistema.criarProjeto(solicitacaoDoCorpo(registro.solicitacao as CorpoRecomendacao, projetoId));
    await this.sistema.restaurarEquipe(projeto);
    return { registro, projeto };
  }

  private exigirConvite(projeto: Projeto, papel: Papel): void {
    if (!projeto.equipe?.membro(papel)) throw new PapelForaDaEquipeError(papel);
  }
}

export function registroDoProjeto(projeto: Projeto, corpo: CorpoRecomendacao): RegistroProjeto {
  return {
    id: projeto.id,
    tipo: projeto.tipo,
    nome: projeto.nome,
    produtor: projeto.produtor,
    orcamento: projeto.orcamento,
    prazo: projeto.prazo.toISOString().slice(0, 10),
    custoEstimado: projeto.calcularCustoTotal(),
    solicitacao: corpo,
  };
}

function membros(equipe: Equipe): MembroDTO[] {
  return equipe.membros.map((m) => ({
    papel: m.papel,
    profissionalId: m.profissional.id,
    nome: m.profissional.nome,
    precoMedio: m.profissional.precoMedio,
  }));
}
