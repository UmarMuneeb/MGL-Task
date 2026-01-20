import { useState, useEffect } from "react";
import { data } from "react-router";
import { authenticate } from "../shopify.server";

// Loader function - runs on server
export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return data({});
};

export default function Index() {
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState("");
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [storesLoading, setStoresLoading] = useState(true);

  // Fetch products and stores when component loads
  useEffect(() => {
    fetchProducts();
    fetchStores();
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const response = await fetch("/app/api/products");
      const dataResponse = await response.json();
      setProducts(dataResponse.products);
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStores = async () => {
    setStoresLoading(true);
    try {
      const response = await fetch("/app/api/stores");
      const dataResponse = await response.json();
      setStores(dataResponse.stores);
      if (dataResponse.stores.length > 0) {
        setSelectedStore(dataResponse.stores[0].value);
      }
    } catch (error) {
      console.error("Error fetching stores:", error);
    } finally {
      setStoresLoading(false);
    }
  };

  const handleStoreChange = (e) => {
    setSelectedStore(e.target.value);
  };

  const handleToggleProduct = (id) => {
    setSelectedProducts((prev) =>
      prev.includes(id) ? prev.filter((pId) => pId !== id) : [...prev, id]
    );
  };

  const handleTestWebhook = () => {
    alert("To test the webhook: Go to Shopify Admin, edit any product title or price, and save. Then check your terminal logs!");
  };

  const handleTransfer = async () => {
    if (selectedProducts.length === 0) {
      alert("Please select at least one product!");
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("productIds", JSON.stringify(selectedProducts));
      formData.append("targetStore", selectedStore);

      const response = await fetch("/app/api/transfer", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      const successes = data.results.filter((r) => r.status === "success");
      const errors = data.results.filter((r) => r.status === "error");

      if (errors.length > 0) {
        alert(
          `Transfer complete!\nSuccess: ${successes.length}\nErrors: ${errors.length}\nCheck console for details.`
        );
        console.error("Transfer errors:", errors);
      } else {
        alert(`Successfully transferred ${successes.length} product(s)!`);
      }
      setSelectedProducts([]);
    } catch (error) {
      alert("Error transferring products: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-container">
      <header className="header">
        <h1>Product Sync Dashboard</h1>
      </header>

      <main>
        {/* Store Selector */}
        <section className="card">
          <h2 className="card-title">Select Target Store</h2>
          <div className="input-group">
            <label htmlFor="store-select" className="label">
              Target Store
            </label>
            {storesLoading ? (
              <div style={{ fontSize: "0.875rem", color: "var(--text-sub)" }}>Loading stores...</div>
            ) : stores.length > 0 ? (
              <select
                id="store-select"
                className="select"
                value={selectedStore}
                onChange={handleStoreChange}
              >
                {stores.map((store) => (
                  <option key={store.value} value={store.value}>
                    {store.label}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ fontSize: "0.875rem", color: "var(--text-sub)", padding: "10px", border: "1px dashed var(--border)", borderRadius: "8px" }}>
                No other stores found. Please install the app on another store to enable transfer.
              </div>
            )}
          </div>
          <p className="tag-sub">
            Products will be transferred to the selected store
          </p>
        </section>

        {/* Product List */}
        <section className="card">
          <div className="flex-between">
            <h2 className="card-title">Available Products</h2>
            <div className="flex-group" style={{ display: "flex", gap: "10px" }}>
              <button
                className="button"
                style={{ backgroundColor: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" }}
                onClick={handleTestWebhook}
              >
                Test Webhook
              </button>
              <button
                className="button button-primary"
                onClick={handleTransfer}
                disabled={selectedProducts.length === 0 || loading}
              >
                Transfer Selected ({selectedProducts.length})
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", color: "var(--text-sub)" }}>
              Loading products...
            </div>
          ) : (
            <ul className="product-list">
              {products.map((product) => (
                <li key={product.id} className="product-item">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={selectedProducts.includes(product.id)}
                    onChange={() => handleToggleProduct(product.id)}
                  />
                  <div className="product-info">
                    <h3>{product.title}</h3>
                    <p>
                      Price: ${product.price} | Inventory: {product.inventory}
                    </p>
                  </div>
                  <span className={`badge ${product.status === "ACTIVE" ? "badge-success" : ""}`} style={{
                    backgroundColor: product.status === "ACTIVE" ? "var(--success-bg)" : "#e2e8f0",
                    color: product.status === "ACTIVE" ? "var(--success-text)" : "#64748b"
                  }}>
                    {product.status}
                  </span>
                </li>
              ))}
              {products.length === 0 && (
                <li className="product-item" style={{ justifyContent: "center", color: "var(--text-sub)" }}>
                  No products found.
                </li>
              )}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}