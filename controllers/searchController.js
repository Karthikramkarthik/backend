const db = require('../config/database');

const staticPages = [
  { title: 'Dashboard', type: 'Page', route: '/dashboard', subtitle: 'Overview & Statistics' },
  { title: 'Products', type: 'Page', route: '/products', subtitle: 'Product Ledger & Stock' },
  { title: 'Categories', type: 'Page', route: '/categories', subtitle: 'Product Categorization' },
  { title: 'Suppliers', type: 'Page', route: '/suppliers', subtitle: 'Vendor Profiles & Info' },
  { title: 'Purchases', type: 'Page', route: '/purchases', subtitle: 'Purchase Inflow Ledger' },
  { title: 'Customers', type: 'Page', route: '/customers', subtitle: 'Customer Ledger Profiles' },
  { title: 'POS Terminal', type: 'Page', route: '/pos', subtitle: 'Point of Sale Billing' },
  { title: 'Sales & Invoices', type: 'Page', route: '/invoices', subtitle: 'Billing & Invoices list' },
  { title: 'E-com Orders', type: 'Page', route: '/orders', subtitle: 'E-commerce Orders list' },
  { title: 'Coupons', type: 'Page', route: '/coupons', subtitle: 'Discount Codes Management' },
  { title: 'Banners', type: 'Page', route: '/banners', subtitle: 'Website Promo Banners' },
  { title: 'Reviews', type: 'Page', route: '/reviews', subtitle: 'Customer Feedback & Reviews' },
  { title: 'Reports', type: 'Page', route: '/reports', subtitle: 'Sales & Profits Reports' },
  { title: 'File Manager', type: 'Page', route: '/file-manager', subtitle: 'Media & File Uploads' },
  { title: 'Instagram Settings', type: 'Page', route: '/instagram-settings', subtitle: 'Social Feed & Feed Settings' },
  { title: 'System Settings', type: 'Page', route: '/system-settings', subtitle: 'Application Configuration' }
];

exports.search = async (req, res) => {
  try {
    const q = req.query.q ? req.query.q.trim() : '';
    if (!q) {
      return res.json({ success: true, results: [] });
    }

    const likeQuery = `%${q}%`;
    const results = [];

    // 1. Search Static Pages
    const matchedPages = staticPages.filter(p => 
      p.title.toLowerCase().includes(q.toLowerCase()) || 
      p.subtitle.toLowerCase().includes(q.toLowerCase())
    );
    results.push(...matchedPages);

    // Helper to run query safely
    const runSearchQuery = async (queryStr, params) => {
      try {
        const [rows] = await db.query(queryStr, params);
        return rows;
      } catch (err) {
        console.error('Search query failed:', err.message);
        return [];
      }
    };

    // 2. Search Products
    const products = await runSearchQuery(
      'SELECT id, name, code, sales_price FROM products WHERE name LIKE ? OR code LIKE ? LIMIT 5',
      [likeQuery, likeQuery]
    );
    products.forEach(p => {
      results.push({
        title: p.name,
        type: 'Product',
        route: `/products`,
        subtitle: `SKU: ${p.code} | Price: ₹${p.sales_price}`
      });
    });

    // 3. Search Categories
    const categories = await runSearchQuery(
      'SELECT id, name FROM categories WHERE name LIKE ? LIMIT 5',
      [likeQuery]
    );
    categories.forEach(c => {
      results.push({
        title: c.name,
        type: 'Category',
        route: '/categories',
        subtitle: 'Product Category'
      });
    });

    // 4. Search Suppliers
    const suppliers = await runSearchQuery(
      'SELECT id, name, mobile FROM suppliers WHERE name LIKE ? OR mobile LIKE ? LIMIT 5',
      [likeQuery, likeQuery]
    );
    suppliers.forEach(s => {
      results.push({
        title: s.name,
        type: 'Supplier',
        route: '/suppliers',
        subtitle: `Phone: ${s.mobile}`
      });
    });

    // 5. Search Customers
    const customers = await runSearchQuery(
      'SELECT id, name, mobile FROM customers WHERE name LIKE ? OR mobile LIKE ? LIMIT 5',
      [likeQuery, likeQuery]
    );
    customers.forEach(c => {
      results.push({
        title: c.name,
        type: 'Customer',
        route: '/customers',
        subtitle: `Phone: ${c.mobile}`
      });
    });

    // 6. Search Sales/Invoices
    const sales = await runSearchQuery(
      'SELECT id, invoice_number, grand_total FROM sales WHERE invoice_number LIKE ? LIMIT 5',
      [likeQuery]
    );
    sales.forEach(s => {
      results.push({
        title: s.invoice_number,
        type: 'Invoice',
        route: `/invoices/view/${s.id}`,
        subtitle: `Total: ₹${s.grand_total}`
      });
    });

    // 7. Search Purchases
    const purchases = await runSearchQuery(
      'SELECT id, invoice_number, total_amount FROM purchases WHERE invoice_number LIKE ? LIMIT 5',
      [likeQuery]
    );
    purchases.forEach(p => {
      results.push({
        title: p.invoice_number || `Purchase #${p.id}`,
        type: 'Purchase',
        route: '/purchases',
        subtitle: `Total Amount: ₹${p.total_amount}`
      });
    });

    // 8. Search Expenses
    const expenses = await runSearchQuery(
      'SELECT id, title, amount FROM expenses WHERE title LIKE ? LIMIT 5',
      [likeQuery]
    );
    expenses.forEach(e => {
      results.push({
        title: e.title,
        type: 'Expense',
        route: '/expenses',
        subtitle: `Amount: ₹${e.amount}`
      });
    });

    // 9. Search Coupons
    const coupons = await runSearchQuery(
      'SELECT id, code, value, type FROM coupons WHERE code LIKE ? LIMIT 5',
      [likeQuery]
    );
    coupons.forEach(c => {
      results.push({
        title: c.code,
        type: 'Coupon',
        route: '/coupons',
        subtitle: `Discount: ${c.value} (${c.type === 'fixed' ? 'Fixed' : 'Percentage'})`
      });
    });

    // 10. Search Orders
    const orders = await runSearchQuery(
      'SELECT id, order_number, customer_name, grand_total FROM orders WHERE order_number LIKE ? OR customer_name LIKE ? LIMIT 5',
      [likeQuery, likeQuery]
    );
    orders.forEach(o => {
      results.push({
        title: o.order_number,
        type: 'Order',
        route: '/orders',
        subtitle: `Customer: ${o.customer_name} | Total: ₹${o.grand_total}`
      });
    });

    res.json({ success: true, results });

  } catch (error) {
    res.status(500).json({ error: 'Search failed: ' + error.message });
  }
};
