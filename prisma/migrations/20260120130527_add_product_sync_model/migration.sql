-- CreateTable
CREATE TABLE "ProductSync" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceStoreId" TEXT NOT NULL,
    "targetStoreId" TEXT NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "targetProductId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductSync_sourceStoreId_targetStoreId_sourceProductId_key" ON "ProductSync"("sourceStoreId", "targetStoreId", "sourceProductId");
