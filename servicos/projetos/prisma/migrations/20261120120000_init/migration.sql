-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StatusProjeto" AS ENUM ('em_formacao', 'equipe_formada', 'finalizado');

-- CreateTable
CREATE TABLE "Projeto" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "produtor" TEXT NOT NULL,
    "status" "StatusProjeto" NOT NULL DEFAULT 'em_formacao',
    "orcamento" DOUBLE PRECISION NOT NULL,
    "prazo" DATE NOT NULL,
    "custoEstimado" DOUBLE PRECISION NOT NULL,
    "solicitacao" JSONB NOT NULL,
    "equipe" JSONB,
    "metricas" JSONB,
    "resultados" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "finalizadoEm" TIMESTAMP(3),

    CONSTRAINT "Projeto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Projeto_produtor_idx" ON "Projeto"("produtor");

-- CreateIndex
CREATE INDEX "Projeto_status_idx" ON "Projeto"("status");

