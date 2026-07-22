import { PrismaClient } from "@prisma/client";

// Prevent creating a new PrismaClient on every hot-reload / serverless
// invocation in dev — reuse a single instance across the module cache.
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
