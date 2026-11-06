-- CreateEnum
CREATE TYPE "ProblemStatus" AS ENUM ('NEW', 'INVESTIGATING', 'KNOWN_ERROR', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('STANDARD', 'NORMAL', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('DRAFT', 'ASSESSMENT', 'PENDING_APPROVAL', 'SCHEDULED', 'IN_PROGRESS', 'REVIEW', 'CLOSED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChangeOutcome" AS ENUM ('SUCCESSFUL', 'PARTIAL', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "CiType" AS ENUM ('HARDWARE', 'SERVER', 'APPLICATION', 'LICENSE', 'SERVICE', 'VENDOR', 'NETWORK', 'DATABASE');

-- CreateEnum
CREATE TYPE "CiStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'RETIRED');

-- AlterTable
ALTER TABLE "Approval" ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "changeSeq" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "problemSeq" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "ServiceItem" ADD COLUMN     "secondApproverId" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "configItemId" TEXT,
ADD COLUMN     "problemId" TEXT;

-- CreateTable
CREATE TABLE "Problem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ProblemStatus" NOT NULL DEFAULT 'NEW',
    "priority" "Priority" NOT NULL DEFAULT 'P3',
    "impact" "Level" NOT NULL DEFAULT 'MEDIUM',
    "urgency" "Level" NOT NULL DEFAULT 'MEDIUM',
    "categoryId" TEXT,
    "teamId" TEXT,
    "ownerId" TEXT,
    "createdById" TEXT NOT NULL,
    "rcaMethod" TEXT,
    "rootCause" TEXT,
    "workaround" TEXT,
    "permanentFix" TEXT,
    "knownErrorAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Problem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProblemTask" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT,
    "dueDate" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProblemTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Change" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT,
    "type" "ChangeType" NOT NULL DEFAULT 'NORMAL',
    "status" "ChangeStatus" NOT NULL DEFAULT 'DRAFT',
    "risk" "Level" NOT NULL DEFAULT 'MEDIUM',
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskAnswers" JSONB,
    "impact" "Level" NOT NULL DEFAULT 'MEDIUM',
    "implementationPlan" TEXT,
    "rollbackPlan" TEXT,
    "testPlan" TEXT,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "outcome" "ChangeOutcome",
    "reviewNotes" TEXT,
    "requesterId" TEXT NOT NULL,
    "ownerId" TEXT,
    "teamId" TEXT,
    "problemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeApproval" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CiType" NOT NULL,
    "status" "CiStatus" NOT NULL DEFAULT 'ACTIVE',
    "criticality" "Level" NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT,
    "ownerId" TEXT,
    "teamId" TEXT,
    "serial" TEXT,
    "location" TEXT,
    "ipAddress" TEXT,
    "version" TEXT,
    "seats" INTEGER,
    "seatsUsed" INTEGER,
    "expiresAt" TEXT,
    "contact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CiRelation" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'DEPENDS_ON',

    CONSTRAINT "CiRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TicketArticles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TicketArticles_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ProblemArticles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProblemArticles_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ChangeCIs" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ChangeCIs_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ProblemCIs" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProblemCIs_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Problem_orgId_status_idx" ON "Problem"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Problem_orgId_number_key" ON "Problem"("orgId", "number");

-- CreateIndex
CREATE INDEX "Change_orgId_status_idx" ON "Change"("orgId", "status");

-- CreateIndex
CREATE INDEX "Change_orgId_plannedStart_idx" ON "Change"("orgId", "plannedStart");

-- CreateIndex
CREATE UNIQUE INDEX "Change_orgId_number_key" ON "Change"("orgId", "number");

-- CreateIndex
CREATE INDEX "ChangeApproval_approverId_status_idx" ON "ChangeApproval"("approverId", "status");

-- CreateIndex
CREATE INDEX "ConfigItem_orgId_type_idx" ON "ConfigItem"("orgId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigItem_orgId_name_key" ON "ConfigItem"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CiRelation_sourceId_targetId_type_key" ON "CiRelation"("sourceId", "targetId", "type");

-- CreateIndex
CREATE INDEX "WorkLog_entityType_entityId_idx" ON "WorkLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "_TicketArticles_B_index" ON "_TicketArticles"("B");

-- CreateIndex
CREATE INDEX "_ProblemArticles_B_index" ON "_ProblemArticles"("B");

-- CreateIndex
CREATE INDEX "_ChangeCIs_B_index" ON "_ChangeCIs"("B");

-- CreateIndex
CREATE INDEX "_ProblemCIs_B_index" ON "_ProblemCIs"("B");

-- CreateIndex
CREATE INDEX "Ticket_problemId_idx" ON "Ticket"("problemId");

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_secondApproverId_fkey" FOREIGN KEY ("secondApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_configItemId_fkey" FOREIGN KEY ("configItemId") REFERENCES "ConfigItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Problem" ADD CONSTRAINT "Problem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTask" ADD CONSTRAINT "ProblemTask_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProblemTask" ADD CONSTRAINT "ProblemTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Change" ADD CONSTRAINT "Change_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Change" ADD CONSTRAINT "Change_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Change" ADD CONSTRAINT "Change_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Change" ADD CONSTRAINT "Change_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Change" ADD CONSTRAINT "Change_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeApproval" ADD CONSTRAINT "ChangeApproval_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "Change"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeApproval" ADD CONSTRAINT "ChangeApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigItem" ADD CONSTRAINT "ConfigItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigItem" ADD CONSTRAINT "ConfigItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigItem" ADD CONSTRAINT "ConfigItem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CiRelation" ADD CONSTRAINT "CiRelation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ConfigItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CiRelation" ADD CONSTRAINT "CiRelation_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "ConfigItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TicketArticles" ADD CONSTRAINT "_TicketArticles_A_fkey" FOREIGN KEY ("A") REFERENCES "KbArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TicketArticles" ADD CONSTRAINT "_TicketArticles_B_fkey" FOREIGN KEY ("B") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProblemArticles" ADD CONSTRAINT "_ProblemArticles_A_fkey" FOREIGN KEY ("A") REFERENCES "KbArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProblemArticles" ADD CONSTRAINT "_ProblemArticles_B_fkey" FOREIGN KEY ("B") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChangeCIs" ADD CONSTRAINT "_ChangeCIs_A_fkey" FOREIGN KEY ("A") REFERENCES "Change"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ChangeCIs" ADD CONSTRAINT "_ChangeCIs_B_fkey" FOREIGN KEY ("B") REFERENCES "ConfigItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProblemCIs" ADD CONSTRAINT "_ProblemCIs_A_fkey" FOREIGN KEY ("A") REFERENCES "ConfigItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProblemCIs" ADD CONSTRAINT "_ProblemCIs_B_fkey" FOREIGN KEY ("B") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
