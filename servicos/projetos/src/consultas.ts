import {
  FILAS,
  OPERACOES_PROJETOS as OP,
  ServidorRpc,
  type MembroDTO,
  type RegistroProjeto,
  type Transporte,
} from '@cinebridge/comum';
import type { GestaoProjetos } from './GestaoProjetos';

/** Atende a fila consulta-projetos, por onde a api registra e consulta os projetos. */
export function servidorConsultas(transporte: Transporte, gestao: GestaoProjetos): ServidorRpc {
  return new ServidorRpc(transporte, FILAS.consultaProjetos, {
    [OP.registrar]: (registro: RegistroProjeto) => gestao.registrar(registro),
    [OP.buscar]: ({ id }: { id: string }) => gestao.buscar(id),
    [OP.formarEquipe]: ({ id, equipe }: { id: string; equipe: MembroDTO[] }) => gestao.formarEquipe(id, equipe),
    [OP.reabrir]: ({ id, alteracoes }: { id: string; alteracoes?: Partial<RegistroProjeto> }) =>
      gestao.reabrir(id, alteracoes),
  });
}
