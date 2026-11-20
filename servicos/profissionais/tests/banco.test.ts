import { execSync } from 'node:child_process';
import { profissionaisDeDemonstracao } from '@cinebridge/comum';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CadastroEmMemoria } from '../src/Cadastro';
import { CadastroPostgres } from '../src/CadastroPostgres';
import { criarPrisma } from '../src/prisma';
import { semear } from '../src/semear';

// Só roda com um PostgreSQL disponível (por exemplo, o profissionais-db do docker compose).
const url = process.env.DATABASE_URL;

describe.skipIf(!url)('PostgreSQL', () => {
  const prisma = criarPrisma(url ?? '');

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', { stdio: 'ignore' });
    await semear(prisma);
  });

  afterAll(() => prisma.$disconnect());

  it('devolve o mesmo cadastro que a versão em memória', async () => {
    const doBanco = await new CadastroPostgres(prisma).listar({ papeis: ['EFEITOS_VISUAIS'] });
    const emMemoria = await new CadastroEmMemoria().listar({ papeis: ['EFEITOS_VISUAIS'] });

    expect(doBanco.map((p) => p.id)).toEqual(emMemoria.map((p) => p.id));
    expect(doBanco.map((p) => p.avaliacoes.length)).toEqual(emMemoria.map((p) => p.avaliacoes.length));
    expect(doBanco[0]?.competencias).toEqual(emMemoria[0]?.competencias);
  });

  it('semear de novo não duplica nada', async () => {
    await expect(semear(prisma)).resolves.toBe(0);
    expect(await prisma.profissional.count()).toBe(16);
    const competencias = profissionaisDeDemonstracao().reduce((soma, p) => soma + p.competencias.length, 0);
    expect(await prisma.competencia.count()).toBe(competencias);
  });
});
