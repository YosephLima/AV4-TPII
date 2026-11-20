import { describe, expect, it } from 'vitest';
import { profissionaisDeDemonstracao, rotaSaude, verificarSaude } from '../src';

describe('verificarSaude', () => {
  it('ok quando todas as dependências respondem', async () => {
    await expect(verificarSaude({ banco: async () => 1, broker: () => true })).resolves.toEqual({
      status: 'ok',
      verificacoes: { banco: 'ok', broker: 'ok' },
    });
  });

  it('aponta qual dependência falhou', async () => {
    const saude = await verificarSaude({
      banco: async () => {
        throw new Error('conexão recusada');
      },
      broker: () => true,
    });
    expect(saude).toEqual({ status: 'falha', verificacoes: { banco: 'conexão recusada', broker: 'ok' } });
  });

  it('uma dependência travada não trava o /health', async () => {
    const saude = await verificarSaude({ banco: () => new Promise(() => {}) }, 20);
    expect(saude.verificacoes.banco).toBe('sem resposta em 20 ms');
  });

  it('a rota responde 503 quando algo falha', async () => {
    let codigo = 0;
    const resposta = { status: (c: number) => ((codigo = c), { send: (corpo: unknown) => corpo }) };
    await rotaSaude({
      broker: () => {
        throw new Error('desconectado');
      },
    })(undefined, resposta);
    expect(codigo).toBe(503);
  });
});

describe('cadastro de demonstração', () => {
  it('traz os 16 profissionais com ids únicos', () => {
    const ids = profissionaisDeDemonstracao().map((p) => p.id);
    expect(ids).toHaveLength(16);
    expect(new Set(ids).size).toBe(16);
  });
});
