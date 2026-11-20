import 'dotenv/config';
import { exigirVariavel } from '@cinebridge/comum';
import { criarPrisma } from '../src/prisma';
import { semear } from '../src/semear';

const prisma = criarPrisma(exigirVariavel('DATABASE_URL'));
const criados = await semear(prisma);
await prisma.$disconnect();
console.log(`Cadastro de demonstração conferido (${criados} profissional(is) novo(s)).`);
