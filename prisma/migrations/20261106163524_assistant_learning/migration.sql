-- CreateTable
CREATE TABLE "AssistantInteraction" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "articleIds" TEXT[],
    "serviceId" TEXT,
    "solutionIds" TEXT[],
    "proposedTicket" BOOLEAN NOT NULL DEFAULT false,
    "feedback" INTEGER,
    "outcome" TEXT,
    "outcomeTarget" TEXT,
    "ticketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantTerm" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "positive" INTEGER NOT NULL DEFAULT 0,
    "negative" INTEGER NOT NULL DEFAULT 0,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnedSolution" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "hiddenReason" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "shown" INTEGER NOT NULL DEFAULT 0,
    "helpful" INTEGER NOT NULL DEFAULT 0,
    "notHelpful" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnedSolution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantInteraction_orgId_createdAt_idx" ON "AssistantInteraction"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantTerm_orgId_term_idx" ON "AssistantTerm"("orgId", "term");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantTerm_orgId_term_targetType_targetId_key" ON "AssistantTerm"("orgId", "term", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "LearnedSolution_ticketId_key" ON "LearnedSolution"("ticketId");

-- CreateIndex
CREATE INDEX "LearnedSolution_orgId_status_idx" ON "LearnedSolution"("orgId", "status");

-- AddForeignKey
ALTER TABLE "AssistantInteraction" ADD CONSTRAINT "AssistantInteraction_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantInteraction" ADD CONSTRAINT "AssistantInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantTerm" ADD CONSTRAINT "AssistantTerm_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnedSolution" ADD CONSTRAINT "LearnedSolution_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnedSolution" ADD CONSTRAINT "LearnedSolution_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnedSolution" ADD CONSTRAINT "LearnedSolution_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
