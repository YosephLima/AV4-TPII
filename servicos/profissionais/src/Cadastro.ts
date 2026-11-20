import {
  ErroOperacao,
  PROFISSIONAL_NAO_ENCONTRADO,
  profissionaisDeDemonstracao,
  type AvaliacaoDTO,
  type CriteriosProfissionais,
  type ProfissionalDTO,
} from '@cinebridge/comum';

/** O cadastro de profissionais, dono do banco profissionais-db. */
export interface Cadastro {
  listar(criterios?: CriteriosProfissionais): Promise<ProfissionalDTO[]>;
  /** Lança ErroOperacao(PROFISSIONAL_NAO_ENCONTRADO), que chega assim à api. */
  detalhar(id: string): Promise<ProfissionalDTO>;
  avaliar(id: string, avaliacao: AvaliacaoDTO): Promise<void>;
  /** Para o /health: lança se o banco não responde. */
  verificar(): Promise<void>;
}

export const naoEncontrado = (id: string) => new ErroOperacao(PROFISSIONAL_NAO_ENCONTRADO, `Profissional não encontrado: ${id}`);

export function atende(profissional: ProfissionalDTO, criterios: CriteriosProfissionais = {}): boolean {
  return (
    (!criterios.papeis || criterios.papeis.some((papel) => profissional.especialidades.includes(papel))) &&
    (!criterios.localizacao || profissional.localizacao === criterios.localizacao)
  );
}

/** Para os testes e para rodar o serviço sem banco. */
export class CadastroEmMemoria implements Cadastro {
  constructor(private readonly profissionais: ProfissionalDTO[] = profissionaisDeDemonstracao()) {}

  async listar(criterios?: CriteriosProfissionais): Promise<ProfissionalDTO[]> {
    return structuredClone(this.profissionais.filter((p) => atende(p, criterios)));
  }

  async detalhar(id: string): Promise<ProfissionalDTO> {
    const encontrado = this.profissionais.find((p) => p.id === id);
    if (!encontrado) throw naoEncontrado(id);
    return structuredClone(encontrado);
  }

  async avaliar(id: string, avaliacao: AvaliacaoDTO): Promise<void> {
    const encontrado = this.profissionais.find((p) => p.id === id);
    if (!encontrado) throw naoEncontrado(id);
    encontrado.avaliacoes.push(avaliacao);
  }

  async verificar(): Promise<void> {}
}
