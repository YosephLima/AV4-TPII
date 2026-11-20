import { profissionaisDeDemonstracao } from '@cinebridge/comum';
import type { Profissional } from '../dominio/Profissional';
import { profissionalDoDTO } from '../mapeamento/profissionais';

/** O mesmo cadastro de demonstração que o serviço de profissionais grava no banco, para rodar sem broker. */
export function profissionaisIniciais(): Profissional[] {
  return profissionaisDeDemonstracao().map(profissionalDoDTO);
}
