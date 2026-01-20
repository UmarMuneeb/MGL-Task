import { data } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
    const { session } = await authenticate.admin(request);
    const currentShop = session.shop;

    try {
        // Fetch all unique shops from the Session table
        const shops = await prisma.session.findMany({
            select: {
                shop: true,
            },
            distinct: ["shop"],
        });

        // Filter out the current shop and format for the Select component
        const otherShops = shops
            .filter((s) => s.shop !== currentShop)
            .map((s) => ({
                label: s.shop,
                value: s.shop,
            }));

        console.log(`Found ${otherShops.length} other shops for ${currentShop}`);

        return data({ stores: otherShops });
    } catch (error) {
        console.error("Error fetching stores:", error);
        return data({ stores: [] }, { status: 500 });
    }
};
