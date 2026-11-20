import type { ProjetoDTO, StatusProjeto } from '@cinebridge/comum';

export interface FiltroProjetos {
  status?: StatusProjeto;
  produtor?: string;
}

/** Guarda os projetos no projetos-db. A regra de negócio fica na GestaoProjetos. */
export interface RepositorioProjetos {
  buscar(id: string): Promise<ProjetoDTO | undefined>;
  listar(filtro?: FiltroProjetos): Promise<ProjetoDTO[]>;
  /** Cria ou substitui. Datas de criação e atualização ficam por conta do repositório. */
  salvar(projeto: ProjetoDTO): Promise<ProjetoDTO>;
  verificar(): Promise<void>;
}

export class RepositorioEmMemoria implements RepositorioProjetos {
  private readonly projetos = new Map<string, ProjetoDTO>();

  async buscar(id: string): Promise<ProjetoDTO | undefined> {
    const projeto = this.projetos.get(id);
    return projeto && structuredClone(projeto);
  }

  async listar(filtro: FiltroProjetos = {}): Promise<ProjetoDTO[]> {
    return [...this.projetos.values()]
      .filter((p) => (!filtro.status || p.status === filtro.status) && (!filtro.produtor || p.produtor === filtro.produtor))
      .map((p) => structuredClone(p));
  }

  async salvar(projeto: ProjetoDTO): Promise<ProjetoDTO> {
    const agora = new Date().toISOString();
    const anterior = this.projetos.get(projeto.id);
    const salvo = { ...structuredClone(projeto), criadoEm: anterior?.criadoEm ?? agora, atualizadoEm: agora };
    this.projetos.set(projeto.id, salvo);
    return structuredClone(salvo);
  }

  async verificar(): Promise<void> {}
}
