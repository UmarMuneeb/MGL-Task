// FILE: app/routes/app.api.products.jsx
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const response = await admin.graphql(
      `#graphql
          query getProducts {
            products(first: 50) {
              edges {
                node {
                  id
                  title
                  status
                  variants(first: 1) {
                    edges {
                      node {
                        price
                        inventoryQuantity
                      }
                    }
                  }
                }
              }
            }
          }`
    );

    const responseJson = await response.json();

    if (!responseJson.data || !responseJson.data.products) {
      return data({ products: [] });
    }

    // Fetch sync records for this shop
    const syncRecords = await db.productSync.findMany({
      where: { sourceStoreId: session.shop }
    });

    const products = responseJson.data.products.edges.map(({ node }) => {
      const syncedTo = syncRecords
        .filter(s => s.sourceProductId === node.id)
        .map(s => s.targetStoreId);

      return {
        id: node.id,
        title: node.title,
        price: node.variants.edges[0]?.node.price || "0.00",
        inventory: node.variants.edges[0]?.node.inventoryQuantity || 0,
        status: node.status,
        syncedTo: syncedTo, // List of stores this product is already in
      };
    });

    return data({ products });
  } catch (error) {
    console.error("Error in product loader:", error);
    return data({ products: [] }, { status: 500 });
  }
};