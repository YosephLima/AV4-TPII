import {
  ErroOperacao,
  FILAS,
  OPERACOES_PROJETOS as OP,
  PROJETO_NAO_ENCONTRADO,
  TRANSICAO_INVALIDA,
  type ClienteRpc,
  type MembroDTO,
  type ProjetoDTO,
  type RegistroProjeto,
} from '@cinebridge/comum';

/**
 * O serviço cinebridge-projetos, fonte de verdade dos projetos, visto pela api. Os erros chegam como ErroOperacao
 * com os códigos do contrato (PROJETO_NAO_ENCONTRADO, TRANSICAO_INVALIDA).
 */
export interface Projetos {
  registrar(registro: RegistroProjeto): Promise<ProjetoDTO>;
  buscar(id: string): Promise<ProjetoDTO>;
  formarEquipe(id: string, equipe: MembroDTO[]): Promise<ProjetoDTO>;
  reabrir(id: string, alteracoes: Partial<RegistroProjeto>): Promise<ProjetoDTO>;
}

/** Cada operação é um pedido na fila consulta-projetos. */
export class ProjetosViaFila implements Projetos {
  constructor(private readonly rpc: ClienteRpc) {}

  registrar(registro: RegistroProjeto): Promise<ProjetoDTO> {
    return this.rpc.chamar(FILAS.consultaProjetos, OP.registrar, registro);
  }

  buscar(id: string): Promise<ProjetoDTO> {
    return this.rpc.chamar(FILAS.consultaProjetos, OP.buscar, { id });
  }

  formarEquipe(id: string, equipe: MembroDTO[]): Promise<ProjetoDTO> {
    return this.rpc.chamar(FILAS.consultaProjetos, OP.formarEquipe, { id, equipe });
  }

  reabrir(id: string, alteracoes: Partial<RegistroProjeto>): Promise<ProjetoDTO> {
    return this.rpc.chamar(FILAS.consultaProjetos, OP.reabrir, { id, alteracoes });
  }
}

/** Para os testes e para rodar a api sozinha, sem o broker. Segue as mesmas transições do serviço. */
export class ProjetosEmMemoria implements Projetos {
  private readonly projetos = new Map<string, ProjetoDTO>();

  async registrar(registro: RegistroProjeto): Promise<ProjetoDTO> {
    const agora = new Date().toISOString();
    const anterior = this.projetos.get(registro.id);
    if (anterior?.status === 'finalizado') throw this.transicaoInvalida(anterior);
    return this.salvar({
      status: 'em_formacao',
      equipe: null,
      metricas: null,
      resultados: null,
      criadoEm: agora,
      finalizadoEm: null,
      ...anterior,
      ...registro,
      atualizadoEm: agora,
    });
  }

  async buscar(id: string): Promise<ProjetoDTO> {
    const projeto = this.projetos.get(id);
    if (!projeto) throw new ErroOperacao(PROJETO_NAO_ENCONTRADO, `Projeto não encontrado: ${id}`);
    return structuredClone(projeto);
  }

  async formarEquipe(id: string, equipe: MembroDTO[]): Promise<ProjetoDTO> {
    const projeto = await this.buscar(id);
    if (projeto.status === 'finalizado') throw this.transicaoInvalida(projeto);
    return this.salvar({ ...projeto, status: 'equipe_formada', equipe });
  }

  async reabrir(id: string, alteracoes: Partial<RegistroProjeto>): Promise<ProjetoDTO> {
    const projeto = await this.buscar(id);
    if (projeto.status === 'finalizado') throw this.transicaoInvalida(projeto);
    return this.salvar({ ...projeto, ...alteracoes, id, status: 'em_formacao', equipe: null });
  }

  /** O que o serviço de projetos faria pela rota de finalização. */
  async finalizar(id: string): Promise<ProjetoDTO> {
    const projeto = await this.buscar(id);
    return this.salvar({ ...projeto, status: 'finalizado', finalizadoEm: new Date().toISOString() });
  }

  private salvar(projeto: ProjetoDTO): ProjetoDTO {
    this.projetos.set(projeto.id, structuredClone(projeto));
    return structuredClone(projeto);
  }

  private transicaoInvalida(projeto: ProjetoDTO): ErroOperacao {
    return new ErroOperacao(TRANSICAO_INVALIDA, `O projeto ${projeto.nome} está ${projeto.status}`);
  }
}
