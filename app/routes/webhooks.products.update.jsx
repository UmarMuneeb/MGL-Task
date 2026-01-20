import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
    console.log("!!! Webhook Request Received !!!");
    try {
        const { topic, shop, payload, admin } = await authenticate.webhook(request);
        console.log(`>>> Webhook Verified: Topic=${topic}, Shop=${shop}, ProductID=${payload.id}`);

        const productGid = `gid://shopify/Product/${payload.id}`;

        // 1. Fetch full product details from source store to ensure we have metafields, SEO, and inventory
        const sourceResponse = await admin.graphql(
            `#graphql
            query getProduct($id: ID!) {
                product(id: $id) {
                    seo { title description }
                    metafields(first: 50) {
                        edges {
                            node { namespace key value type }
                        }
                    }
                    variants(first: 100) {
                        edges {
                            node {
                                sku
                                inventoryItem {
                                    inventoryLevels(first: 1) {
                                        edges {
                                            node {
                                                quantities(names: ["available"]) {
                                                    name
                                                    quantity
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }`,
            { variables: { id: productGid } }
        );
        const sourceJson = await sourceResponse.json();
        const sourceProduct = sourceJson.data?.product;

        // Find synced products - Bidirectional search
        const syncRecords = await db.productSync.findMany({
            where: {
                OR: [
                    { sourceStoreId: shop, sourceProductId: productGid }, // Shop is Source
                    { targetStoreId: shop, targetProductId: productGid }  // Shop is Target
                ]
            },
        });

        // Update each connected store
        for (const sync of syncRecords) {
            try {
                // Determine direction: sync away from the store that triggered the webhook
                const isShopSource = sync.sourceStoreId === shop;
                const targetStoreId = isShopSource ? sync.targetStoreId : sync.sourceStoreId;
                const targetProductId = isShopSource ? sync.targetProductId : sync.sourceProductId;

                console.log(`Syncing update from ${shop} to ${targetStoreId}...`);
                const { admin: targetAdmin } = await unauthenticated.admin(targetStoreId);

                // Fetch target store's primary location
                const locationResponse = await targetAdmin.graphql(
                    `#graphql
                    query {
                        locations(first: 1, query: "is_primary:true") {
                            edges {
                                node {
                                    id
                                }
                            }
                        }
                    }`
                );
                const locationData = await locationResponse.json();
                const targetLocationId = locationData.data?.locations?.edges[0]?.node?.id;

                if (!targetLocationId) {
                    console.error(`Could not find primary location for ${sync.targetStoreId}`);
                    continue;
                }

                // Map webhook payload + fetched data to productSet input
                const productInput = {
                    id: targetProductId,
                    title: payload.title,
                    descriptionHtml: payload.body_html,
                    vendor: payload.vendor,
                    productType: payload.product_type,
                    status: payload.status.toUpperCase(),
                    tags: payload.tags ? payload.tags.split(", ").map(tag => tag.trim()) : [],
                    seo: sourceProduct?.seo ? {
                        title: sourceProduct.seo.title,
                        description: sourceProduct.seo.description
                    } : undefined,
                    metafields: sourceProduct?.metafields ? sourceProduct.metafields.edges
                        .map(edge => edge.node)
                        .filter(meta => {
                            // Filter out reference types that are store-specific and will cause errors
                            const type = meta.type.toLowerCase();
                            return !type.includes("reference") && !type.includes("metaobject") && !type.includes("file");
                        })
                        .map(meta => ({
                            namespace: meta.namespace,
                            key: meta.key,
                            value: meta.value,
                            type: meta.type
                        })) : [],
                    files: payload.images ? payload.images.map(img => ({
                        alt: img.alt,
                        contentType: "IMAGE",
                        originalSource: img.src
                    })) : [],
                    productOptions: payload.options.map(opt => ({
                        name: opt.name,
                        values: opt.values.map(val => ({ name: val }))
                    })),
                    variants: payload.variants.map(variant => {
                        const variantInput = {
                            price: variant.price,
                            compareAtPrice: variant.compare_at_price,
                            sku: variant.sku,
                            barcode: variant.barcode,
                            optionValues: payload.options.map((opt, index) => ({
                                optionName: opt.name,
                                name: variant[`option${index + 1}`]
                            })).filter(ov => ov.name !== null)
                        };

                        // Match source inventory quantity for this variant SKU
                        const sourceVariant = sourceProduct?.variants?.edges.find(e => e.node.sku === variant.sku);
                        const availableQty = sourceVariant?.node?.inventoryItem?.inventoryLevels?.edges[0]?.node?.quantities?.find(q => q.name === "available")?.quantity;

                        if (typeof availableQty === 'number') {
                            variantInput.inventoryQuantities = [{
                                locationId: targetLocationId,
                                name: "available",
                                quantity: availableQty
                            }];
                        }

                        return variantInput;
                    })
                };

                const setResponse = await targetAdmin.graphql(
                    `#graphql
                    mutation productSet($input: ProductSetInput!) {
                        productSet(input: $input) {
                            product {
                                id
                                title
                                seo { title description }
                                metafields(first: 50) {
                                    edges {
                                        node { namespace key value type }
                                    }
                                }
                                media(first: 10) {
                                    edges {
                                        node { alt }
                                    }
                                }
                            }
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
