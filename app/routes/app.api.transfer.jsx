// FILE: app/routes/app.api.transfer.jsx
import { json } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);

    const formData = await request.formData();
    const productIds = JSON.parse(formData.get("productIds"));
    const targetStore = formData.get("targetStore");

    console.log(`Starting transfer for ${productIds.length} products to ${targetStore}`);

    const results = [];

    try {
        // Get target store admin context
        const { admin: targetAdmin } = await unauthenticated.admin(targetStore);

        for (const productId of productIds) {
            try {
                console.log(`Fetching source product: ${productId}`);
                // 1. Fetch product details from source store
                const response = await admin.graphql(
                    `#graphql
                    query getProduct($id: ID!) {
                        product(id: $id) {
                            title
                            descriptionHtml
                            status
                            vendor
                            productType
                            tags
                            options {
                                name
                                values
                            }
                            variants(first: 100) {
                                edges {
                                    node {
                                        price
                                        compareAtPrice
                                        sku
                                        barcode
                                        selectedOptions {
                                            name
                                            value
                                        }
                                        inventoryItem {
                                            measurement {
                                                weight {
                                                    value
                                                    unit
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }`,
                    { variables: { id: productId } }
                );

                const sourceData = await response.json();
                const product = sourceData.data.product;

                if (!product) {
                    throw new Error(`Product not found in source store: ${productId}`);
                }

                console.log(`Setting product in target store: ${product.title}`);

                // 2. Prepare productSet input for target store
                // Note: productSet is the modern way to create/update products with variants in one shot
                const productInput = {
                    title: product.title,
                    descriptionHtml: product.descriptionHtml,
                    status: product.status,
                    vendor: product.vendor,
                    productType: product.productType,
                    tags: product.tags,
                    productOptions: product.options.map(opt => ({
                        name: opt.name,
                        values: opt.values.map(val => ({ name: val }))
                    })),
                    variants: product.variants.edges.map(edge => {
                        const variant = {
                            price: edge.node.price,
                            compareAtPrice: edge.node.compareAtPrice,
                            sku: edge.node.sku,
                            barcode: edge.node.barcode,
                            optionValues: edge.node.selectedOptions.map(opt => ({
                                optionName: opt.name,
                                name: opt.value
                            }))
                        };

                        // Add weight if available
                        if (edge.node.inventoryItem?.measurement?.weight) {
                            variant.inventoryItem = {
                                measurement: {
                                    weight: {
                                        value: edge.node.inventoryItem.measurement.weight.value,
                                        unit: edge.node.inventoryItem.measurement.weight.unit
                                    }
                                }
                            };
                        }

                        return variant;
                    })
                };

                // 3. Use productSet mutation
                const setResponse = await targetAdmin.graphql(
                    `#graphql
                    mutation productSet($input: ProductSetInput!) {
                        productSet(input: $input) {
                            product {
                                id
                                title
                            }
                            userErrors {
                                field
                                message
                            }
                        }
                    }`,
                    { variables: { input: productInput } }
                );

                const setResponseData = await setResponse.json();

                if (setResponseData.data?.productSet?.userErrors?.length > 0) {
                    const errorMsg = setResponseData.data.productSet.userErrors[0].message;
                    console.error(`Target store productSet error for ${product.title}:`, errorMsg);
                    throw new Error(errorMsg);
                }

                if (!setResponseData.data?.productSet?.product) {
                    console.error("Unknown error: No product returned from target store", setResponseData);
                    throw new Error("No product returned from target store");
                }

                const newProductId = setResponseData.data.productSet.product.id;
                console.log(`Successfully synced in target: ${newProductId}. Updating database...`);

                // 4. Save/Update sync record
                const upsertResult = await db.productSync.upsert({
                    where: {
                        sourceStoreId_targetStoreId_sourceProductId: {
                            sourceStoreId: session.shop,
                            targetStoreId: targetStore,
                            sourceProductId: productId,
                        }
                    },
                    update: {
                        targetProductId: newProductId,
                        updatedAt: new Date(),
                    },
                    create: {
                        sourceStoreId: session.shop,
                        targetStoreId: targetStore,
                        sourceProductId: productId,
                        targetProductId: newProductId,
                    },
                });

                console.log(`Database updated for ${productId}:`, upsertResult.id);

                results.push({
                    productId,
                    title: product.title,
                    status: "success",
                    targetProductId: newProductId
                });
            } catch (error) {
                console.error(`Error transferring individual product ${productId}:`, error.message);
                results.push({
                    productId,
                    status: "error",
                    error: error.message,
                });
            }
        }
    } catch (globalError) {
        console.error("Global transfer error:", globalError.message);
        return json({
            results: productIds.map(id => ({
                productId: id,
                status: "error",
                error: "Target store authentication failed or operation timed out"
            }))
        }, { status: 500 });
    }

    return json({ results });
};