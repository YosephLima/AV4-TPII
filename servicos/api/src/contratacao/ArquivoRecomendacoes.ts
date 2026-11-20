import { ArquivoNaoEncontradoError, type AdaptadorArmazenamento } from '../adaptadores/armazenamento/AdaptadorArmazenamento';
import type { Equipe } from '../dominio/Equipe';
import type { Projeto } from '../dominio/Projeto';
import {
  equipeDoEstado,
  registroDe,
  semEstado,
  type RecomendacaoArquivada,
  type RegistroRecomendacao,
} from './estadoEquipe';

export type { RecomendacaoArquivada } from './estadoEquipe';

/** Onde as recomendações ficam guardadas. Na AV4, o padrão em produção é o banco recomendacoes-db. */
export interface Arquivo {
  guardar(projeto: Projeto, equipe: Equipe): Promise<unknown>;
  /** Lança ArquivoNaoEncontradoError se o projeto não tem recomendação. */
  consultar(projetoId: string): Promise<RecomendacaoArquivada>;
  carregarEquipe(projetoId: string): Promise<Equipe | undefined>;
}

/** Guarda cada recomendação no armazenamento configurado (Adapter da AV3), para quando não há banco. */
export class ArquivoRecomendacoes implements Arquivo {
  static readonly PASTA = 'recomendacoes/';

  constructor(private readonly armazenamento: AdaptadorArmazenamento) {}

  async guardar(projeto: Projeto, equipe: Equipe): Promise<string> {
    return this.armazenamento.salvarArquivo(Buffer.from(JSON.stringify(registroDe(projeto, equipe))), {
      caminho: this.caminho(projeto.id),
      tipoConteudo: 'application/json',
      extras: { tipo: projeto.tipo },
    });
  }

  async consultar(projetoId: string): Promise<RecomendacaoArquivada> {
    return semEstado(await this.ler(projetoId));
  }

  async carregarEquipe(projetoId: string): Promise<Equipe | undefined> {
    try {
      return equipeDoEstado((await this.ler(projetoId)).estado);
    } catch (erro) {
      if (erro instanceof ArquivoNaoEncontradoError) return undefined;
      throw erro;
    }
  }

  private async ler(projetoId: string): Promise<RegistroRecomendacao> {
    const conteudo = await this.armazenamento.recuperarArquivo(this.caminho(projetoId));
    return JSON.parse(conteudo.toString('utf8')) as RegistroRecomendacao;
  }

  private caminho(projetoId: string): string {
    return `${ArquivoRecomendacoes.PASTA}${projetoId}.json`;
  }
}
