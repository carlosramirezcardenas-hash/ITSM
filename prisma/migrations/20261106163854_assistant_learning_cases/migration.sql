/*
  Warnings:

  - You are about to drop the column `ticketId` on the `LearnedSolution` table. All the data in the column will be lost.
  - Added the required column `originalResolution` to the `LearnedSolution` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "LearnedSolution" DROP CONSTRAINT "LearnedSolution_ticketId_fkey";

-- DropIndex
DROP INDEX "LearnedSolution_ticketId_key";

-- AlterTable
ALTER TABLE "LearnedSolution" DROP COLUMN "ticketId",
ADD COLUMN     "originalResolution" TEXT NOT NULL,
ADD COLUMN     "ticketIds" TEXT[];
