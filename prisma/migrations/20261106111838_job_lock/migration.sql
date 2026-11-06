-- CreateTable
CREATE TABLE "JobLock" (
    "name" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLock_pkey" PRIMARY KEY ("name")
);
