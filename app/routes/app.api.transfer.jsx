import { json } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
    const { admin, session } = await authenticate.admin(request);

    const formData = await request.formData();
    const productIds = JSON.parse(formData.get("productIds"));
    const rawTargetStore = formData.get("targetStore");
    const targetStore = typeof rawTargetStore === "string" ? rawTargetStore.trim() : rawTargetStore;

    console.log(`Transfer API received targetStore: "${targetStore}" (type: ${typeof targetStore})`);

    const results = [];

    try {
        if (!targetStore || targetStore === "undefined" || targetStore === "null") {
            throw new Error("No valid target store selected");
        }

        // Basic shop domain validation
        if (!targetStore.includes(".myshopify.com")) {
            throw new Error(`Invalid shop domain: ${targetStore}`);
        }

        // Ensure it's a valid shop domain if possible, or at least not empty
        const { admin: targetAdmin } = await unauthenticated.admin(targetStore);

        for (const productId of productIds) {
            try {
                // 1. Fetch source product with all details including inventory
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
                            seo {
                                title
                                description
                            }
                            metafields(first: 50) {
                                edges {
                                    node {
                                        namespace
                                        key
                                        value
                                        type
                                    }
                                }
                            }
                            media(first: 20) {
                                edges {
                                    node {
                                        ... on MediaImage {
                                            image {
                                                url
                                                altText
                                            }
                                        }
                                    }
                                }
                            }
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

                // 2. Fetch target store's primary location
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
                    throw new Error(`Could not find a primary location in target store: ${targetStore}`);
                }

                // 3. Map to productSet input
                const productInput = {
                    title: product.title,
                    descriptionHtml: product.descriptionHtml,
                    status: product.status,
                    vendor: product.vendor,
                    productType: product.productType,
                    tags: product.tags,
                    seo: product.seo ? {
                        title: product.seo.title,
                        description: product.seo.description
                    } : undefined,
                    metafields: product.metafields.edges.map(edge => ({
                        namespace: edge.node.namespace,
                        key: edge.node.key,
                        value: edge.node.value,
                        type: edge.node.type
                    })),
                    files: product.media.edges
                        .filter(edge => edge.node.image)
                        .map(edge => ({
                            alt: edge.node.image.altText,
                            contentType: "IMAGE",
                            originalSource: edge.node.image.url
                        })),
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
                            })),
                            inventoryItem: edge.node.inventoryItem?.measurement?.weight ? {
                                measurement: {
                                    weight: {
                                        value: edge.node.inventoryItem.measurement.weight.value,
                                        unit: edge.node.inventoryItem.measurement.weight.unit
                                    }
                                }
                            } : undefined
                        };

                        // Add inventory quantity if available
                        const availableQty = edge.node.inventoryItem?.inventoryLevels?.edges[0]?.node?.quantities?.find(q => q.name === "available")?.quantity;
                        if (typeof availableQty === 'number') {
                            variant.inventoryQuantities = [{
                                locationId: targetLocationId,
                                name: "available",
                                quantity: availableQty
                            }];
                        }

                        return variant;
                    })
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
