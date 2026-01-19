import { useState } from "react";

export default function Index() {
  // Dummy data for stores
  const stores = [
    { label: "Store A (Current)", value: "store-a" },
    { label: "Store B", value: "store-b" },
    { label: "Store C", value: "store-c" },
  ];

  // Dummy product data
  const dummyProducts = [
    {
      id: "1",
      title: "Cool T-Shirt",
      price: "$29.99",
      inventory: 50,
      status: "Active",
    },
    {
      id: "2",
      title: "Awesome Mug",
      price: "$14.99",
      inventory: 100,
      status: "Active",
    },
    {
      id: "3",
      title: "Fancy Hat",
      price: "$24.99",
      inventory: 25,
      status: "Active",
    },
  ];

  // State
  const [selectedStore, setSelectedStore] = useState("store-b");
  const [selectedProducts, setSelectedProducts] = useState([]);

  // Handle store selection
  const handleStoreChange = (e) => {
    setSelectedStore(e.target.value);
  };

  // Handle product selection checkbox change
  const handleToggleProduct = (id) => {
    setSelectedProducts((prev) =>
      prev.includes(id) ? prev.filter((pId) => pId !== id) : [...prev, id]
    );
  };

  // Handle transfer button click
  const handleTransfer = () => {
    if (selectedProducts.length === 0) {
      alert("Please select at least one product!");
      return;
    }
    const storeLabel = stores.find(s => s.value === selectedStore)?.label;
    alert(`Transferring ${selectedProducts.length} product(s) to ${storeLabel}`);
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
          </div>
          <p className="tag-sub">
            Products will be transferred to the selected store
          </p>
        </section>

        {/* Product List */}
        <section className="card">
          <div className="flex-between">
            <h2 className="card-title">Available Products</h2>
            <button
              className="button button-primary"
              onClick={handleTransfer}
              disabled={selectedProducts.length === 0}
            >
              Transfer Selected ({selectedProducts.length})
            </button>
          </div>

          <ul className="product-list">
            {dummyProducts.map((product) => (
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
                    Price: {product.price} | Inventory: {product.inventory}
                  </p>
                </div>
                <span className="badge badge-success">{product.status}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}