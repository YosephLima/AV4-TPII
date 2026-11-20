-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Canal" AS ENUM ('email', 'interna');

-- CreateTable
CREATE TABLE "Notificacao" (
    "id" SERIAL NOT NULL,
    "eventoId" TEXT NOT NULL,
    "tipoEvento" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "projetoId" TEXT,
    "canal" "Canal" NOT NULL,
    "destinatario" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notificacao_destinatario_idx" ON "Notificacao"("destinatario");

-- CreateIndex
CREATE INDEX "Notificacao_projetoId_idx" ON "Notificacao"("projetoId");

-- CreateIndex
CREATE UNIQUE INDEX "Notificacao_eventoId_canal_destinatario_key" ON "Notificacao"("eventoId", "canal", "destinatario");

