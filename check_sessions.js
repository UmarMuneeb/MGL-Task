import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
    const sessions = await prisma.session.findMany({
        select: {
            shop: true,
            isOnline: true,
        },
    });
    console.log("Current Sessions in DB:");
    console.table(sessions);
}

main()
    .catch((e) => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
