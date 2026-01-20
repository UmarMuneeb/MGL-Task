// FILE: app/routes/app.api.products.jsx
import { data } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
    const { admin } = await authenticate.admin(request);

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
        console.log("GraphQL Response:", JSON.stringify(responseJson, null, 2));

        if (!responseJson.data || !responseJson.data.products) {
            console.error("Invalid GraphQL response structure:", responseJson);
            return data({ products: [] });
        }

        const products = responseJson.data.products.edges.map(({ node }) => ({
            id: node.id,
            title: node.title,
            price: node.variants.edges[0]?.node.price || "0.00",
            inventory: node.variants.edges[0]?.node.inventoryQuantity || 0,
            status: node.status,
        }));

        console.log("Transformed Products:", products.length);
        return data({ products });
    } catch (error) {
        console.error("Error in product loader:", error);
        return data({ products: [] }, { status: 500 });
    }
};