-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Recomendacao" (
    "projetoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "produtor" TEXT NOT NULL,
    "custoEstimado" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "equipe" JSONB NOT NULL,
    "estado" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recomendacao_pkey" PRIMARY KEY ("projetoId")
);

-- CreateTable
CREATE TABLE "Rodada" (
    "id" SERIAL NOT NULL,
    "projetoId" TEXT NOT NULL,
    "equipeId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "equipe" JSONB NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rodada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rodada_projetoId_idx" ON "Rodada"("projetoId");

-- AddForeignKey
ALTER TABLE "Rodada" ADD CONSTRAINT "Rodada_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Recomendacao"("projetoId") ON DELETE CASCADE ON UPDATE CASCADE;

