import { json } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);

    const formData = await request.formData();
    const productIds = JSON.parse(formData.get("productIds"));
    const targetStore = formData.get("targetStore");

    const results = [];

    try {
        const { admin: targetAdmin } = await unauthenticated.admin(targetStore);

        for (const productId of productIds) {
            try {
                // 1. Fetch source product
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

                // 2. Map to productSet input
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
                    variants: product.variants.edges.map(edge => ({
                        price: edge.node.price,
                        compareAtPrice: edge.node.compareAtPrice,
                        sku: edge.node.sku,
                        barcode: edge.node.barcode,
                        optionValues: edge.node.selectedOptions.map(opt => ({
                            optionName: opt.name,
                            name: opt.value
                        })),
                        inventoryItem: edge.node.inventoryItem?.measurement?.weight ? {
                            measurement: {
                                weight: {
                                    value: edge.node.inventoryItem.measurement.weight.value,
                                    unit: edge.node.inventoryItem.measurement.weight.unit
                                }
                            }
                        } : undefined
                    }))
                };

                // 3. Sync to target
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
                    throw new Error(setResponseData.data.productSet.userErrors[0].message);
                }

                const newProductId = setResponseData.data.productSet.product.id;

                // 4. Save/Update sync record
                await db.productSync.upsert({
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

                results.push({
                    productId,
                    title: product.title,
                    status: "success",
                    targetProductId: newProductId
                });
            } catch (error) {
                results.push({
                    productId,
                    status: "error",
                    error: error.message,
                });
            }
        }
    } catch (globalError) {
        return json({ results: [{ status: "error", error: globalError.message }] }, { status: 500 });
    }

    return json({ results });
};
