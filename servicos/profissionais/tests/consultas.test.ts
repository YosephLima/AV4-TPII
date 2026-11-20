import {
  ClienteRpc,
  ErroOperacao,
  FILAS,
  OPERACOES_PROFISSIONAIS as OP,
  PROFISSIONAL_NAO_ENCONTRADO,
  TransporteMemoria,
  type ProfissionalDTO,
} from '@cinebridge/comum';
import { afterAll, describe, expect, it } from 'vitest';
import { construirApp } from '../src/app';
import { CadastroEmMemoria } from '../src/Cadastro';
import { servidorConsultas } from '../src/consultas';

async function montar() {
  const transporte = new TransporteMemoria();
  const cadastro = new CadastroEmMemoria();
  await servidorConsultas(transporte, cadastro).iniciar();
  const cliente = await new ClienteRpc(transporte, 500).iniciar();
  const chamar = <T>(operacao: string, dados?: unknown) => cliente.chamar<T>(FILAS.consultaProfissionais, operacao, dados);
  return { cadastro, chamar };
}

describe('fila consulta-profissionais', () => {
  it('lista filtrando por papel e localização', async () => {
    const { chamar } = await montar();
    const editores = await chamar<ProfissionalDTO[]>(OP.listar, { papeis: ['EDITOR'] });
    expect(editores.map((p) => p.id)).toEqual(['p09', 'p10', 'p11']);

    const editoresEmSp = await chamar<ProfissionalDTO[]>(OP.listar, { papeis: ['EDITOR'], localizacao: 'São Paulo' });
    expect(editoresEmSp.map((p) => p.id)).toEqual(['p09', 'p11']);
  });

  it('sem critérios, lista todos', async () => {
    const { chamar } = await montar();
    await expect(chamar<ProfissionalDTO[]>(OP.listar)).resolves.toHaveLength(16);
  });

  it('detalha um profissional, e um id desconhecido volta como erro de negócio', async () => {
    const { chamar } = await montar();
    await expect(chamar<ProfissionalDTO>(OP.detalhar, { id: 'p04' })).resolves.toMatchObject({ nome: 'Diego Alves' });

    const erro = await chamar(OP.detalhar, { id: 'p99' }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroOperacao);
    expect((erro as ErroOperacao).codigo).toBe(PROFISSIONAL_NAO_ENCONTRADO);
  });

  it('registra avaliação', async () => {
    const { chamar, cadastro } = await montar();
    await chamar(OP.avaliar, { profissionalId: 'p06', avaliacao: { nota: 5, comentario: 'ótimo', data: '2026-11-01' } });
    expect((await cadastro.detalhar('p06')).avaliacoes).toHaveLength(1);
  });
});

describe('HTTP', () => {
  let banco = true;
  const app = construirApp(new CadastroEmMemoria(), {
    banco: () => {
      if (!banco) throw new Error('conexão recusada');
    },
  });
  afterAll(() => app.close());

  it('/health responde 200 e depois 503 quando o banco cai', async () => {
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    banco = false;
    const resposta = await app.inject({ url: '/health' });
    expect(resposta.statusCode).toBe(503);
    expect(resposta.json()).toEqual({ status: 'falha', verificacoes: { banco: 'conexão recusada' } });
    banco = true;
  });

  it('consulta por papel e por id', async () => {
    const lista = await app.inject({ url: '/profissionais?papel=SONOPLASTA' });
    expect(lista.json().map((p: ProfissionalDTO) => p.id)).toEqual(['p07', 'p08']);
    expect((await app.inject({ url: '/profissionais/p99' })).statusCode).toBe(404);
  });
});
