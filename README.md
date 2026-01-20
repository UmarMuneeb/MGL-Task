# Shopify Product Transfer App

A professional Shopify application designed to synchronize products between multiple stores with high fidelity and real-time updates.

## Installation

1. Clone the repository
2. Install the necessary dependencies:
   ```bash
   npm install
   ```
3. Initialize the local database:
   ```bash
   npx prisma db push
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Follow the Shopify CLI prompts to authenticate and select your development stores.

## Technical Implementation

### Product Fetching
The application retrieves product data from the Shopify Admin GraphQL API. The logic resides in `app/routes/app.api.products.jsx`. 
- **Process**: It fetches a list of products including their titles, primary images, and variants.
- **Sync Status**: For each product, it queries the local database to check for existing `ProductSync` records. This allows the UI to display "Synced to" badges, indicating which target stores already have a copy of the product.

### Transfer API
The initial product copying process is handled by the Transfer API in `app/routes/app.api.transfer.jsx`.
- **Communication**: It uses the `unauthenticated.admin` utility to establish an authenticated connection to the target store using stored session tokens.
- **Data Mapping**: It performs a deep fetch of the source product, including SEO metadata, media files, and inventory levels.
- **Robustness**: The API includes logic to filter out store-specific "reference" metafields (such as Metaobjects or specific File references) that would fail in a different store's environment.
- **Execution**: The `productSet` mutation is used to create or update the product in the target store in a single atomic operation.
- **Inventory**: It automatically identifies the target store's primary location and maps the source inventory quantities accordingly.

### Webhooks (Real-time Sync)
Bidirectional synchronization is maintained through Shopify Webhooks.
- **Topic**: `products/update`
- **Handler**: `app/routes/webhooks.products.update.jsx`
- **Bidirectional Logic**: The handler is designed to be store-agnostic. It detects whether the incoming update is from a "source" or a "target" store by performing an OR lookup in the synchronization database. This allows updates made in any connected store to propagate to all other linked stores.
- **Registration**: To handle changing development tunnel URLs, the app performs a forced webhook registration in the main dashboard loader (`app/routes/app._index.jsx`) every time the user accesses the interface. This ensures the sync path remains active during local development.

## Project Structure
- `app/routes/app._index.jsx`: Main UI and store selection logic.
- `app/routes/app.api.transfer.jsx`: Backend logic for the initial product transfer.
- `app/routes/webhooks.products.update.jsx`: Logic for real-time synchronization.
- `prisma/schema.prisma`: Database schema for tracking synchronized products.
