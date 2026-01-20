// FILE: app/routes/webhooks.products.update.jsx
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
    try {
        const { topic, shop, payload } = await authenticate.webhook(request);

        console.log(`Webhook: Product ${payload.id} updated in ${shop}`);

        const productGid = `gid://shopify/Product/${payload.id}`;

        // Find synced products
        const syncRecords = await db.productSync.findMany({
            where: {
                sourceStoreId: shop,
                sourceProductId: productGid,
            },
        });

        // Update each target store
        for (const sync of syncRecords) {
            try {
                console.log(`Syncing update to ${sync.targetStoreId}...`);
                const { admin: targetAdmin } = await unauthenticated.admin(sync.targetStoreId);

                // Map webhook payload to productSet input
                const productInput = {
                    id: sync.targetProductId,
                    title: payload.title,
                    descriptionHtml: payload.body_html,
                    vendor: payload.vendor,
                    productType: payload.product_type,
                    status: payload.status.toUpperCase(),
                    tags: payload.tags ? payload.tags.split(", ").map(tag => tag.trim()) : [],
                    productOptions: payload.options.map(opt => ({
                        name: opt.name,
                        values: opt.values.map(val => ({ name: val }))
                    })),
                    variants: payload.variants.map(variant => ({
                        price: variant.price,
                        compareAtPrice: variant.compare_at_price,
                        sku: variant.sku,
                        barcode: variant.barcode,
                        optionValues: payload.options.map((opt, index) => ({
                            optionName: opt.name,
                            name: variant[`option${index + 1}`]
                        })).filter(ov => ov.name !== null),
                        // Note: inventory management would require more complex handling with inventoryItem
                    }))
                };

                const setResponse = await targetAdmin.graphql(
                    `#graphql
                    mutation productSet($input: ProductSetInput!) {
                        productSet(input: $input) {
                            product { id title }
                            userErrors { field message }
                        }
                    }`,
                    { variables: { input: productInput } }
                );

                const setResponseData = await setResponse.json();

                if (setResponseData.data?.productSet?.userErrors?.length > 0) {
                    console.error(`Status sync error for ${sync.targetStoreId}:`, setResponseData.data.productSet.userErrors);
                } else {
                    console.log(`✓ Successfully synced to ${sync.targetStoreId}`);
                }
            } catch (error) {
                console.error(`✗ Sync failed for ${sync.targetStoreId}:`, error.message);
            }
        }

        return new Response("OK", { status: 200 });
    } catch (error) {
        console.error("Webhook error:", error);
        return new Response("Error", { status: 500 });
    }
};
