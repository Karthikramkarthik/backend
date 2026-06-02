const db = require('../config/database');

exports.getMetrics = async (req, res) => {
  try {
    // 1. Fetch count stats
    const [[{ invoices }]] = await db.query('SELECT count(*) AS invoices FROM sales');
    const [[{ customers }]] = await db.query('SELECT count(*) AS customers FROM customers');
    const [[{ suppliers }]] = await db.query('SELECT count(*) AS suppliers FROM suppliers');
    const [[{ products }]] = await db.query('SELECT COUNT(DISTINCT code) AS products FROM products');
    const [[{ purchases }]] = await db.query('SELECT COALESCE(SUM(total_amount), 0) AS purchases FROM purchases');
    const [[{ sales }]] = await db.query('SELECT COALESCE(SUM(grand_total), 0) AS sales FROM sales');
    const [[{ low_stock }]] = await db.query('SELECT COUNT(DISTINCT code) AS low_stock FROM products WHERE stock_quantity <= 10');
    
    // E-Commerce Orders stats
    const [[{ total_orders }]] = await db.query('SELECT count(*) AS total_orders FROM orders');
    const [[{ pending_orders }]] = await db.query('SELECT count(*) AS pending_orders FROM orders WHERE status = "Pending"');
    const [[{ ecom_sales }]] = await db.query('SELECT COALESCE(SUM(grand_total), 0) AS ecom_sales FROM orders WHERE status != "Cancelled"');

    // Calculate Profit: (Store Sales + Ecom Sales - Store Shipping - Ecom Shipping - COGS)
    // We fetch COGS for store sales first:
    const [[{ store_cogs }]] = await db.query(`
      SELECT COALESCE(SUM(p.purchase_price * si.quantity), 0) AS cogs 
      FROM sale_items si 
      JOIN products p ON si.product_id = p.id
    `);
    
    // COGS for e-commerce orders:
    const [[{ ecom_cogs }]] = await db.query(`
      SELECT COALESCE(SUM(p.purchase_price * oi.quantity), 0) AS cogs 
      FROM order_items oi 
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status != 'Cancelled'
    `);

    const [[{ store_shipping }]] = await db.query('SELECT COALESCE(SUM(shipping_charge), 0) as s FROM sales');
    const totalRevenue = parseFloat(sales) + parseFloat(ecom_sales);
    const totalProfit = parseFloat(sales) - parseFloat(store_shipping) + parseFloat(ecom_sales) - parseFloat(store_cogs) - parseFloat(ecom_cogs);

    // 2. Fetch recent purchases
    const [recentPurchases] = await db.query(`
      SELECT p.invoice_number, s.name as supplier, p.total_amount, DATE_FORMAT(p.purchase_date, '%Y-%m-%d') as purchase_date 
      FROM purchases p 
      JOIN suppliers s ON p.supplier_id = s.id 
      ORDER BY p.created_at DESC LIMIT 5
    `);

    // 3. Fetch recent store sales
    const [recentSales] = await db.query(`
      SELECT s.id, s.invoice_number, c.name as customer, s.grand_total, DATE_FORMAT(s.sale_date, '%Y-%m-%d') as sale_date 
      FROM sales s 
      JOIN customers c ON s.customer_id = c.id 
      ORDER BY s.created_at DESC LIMIT 5
    `);

    // Fetch recent e-commerce orders
    const [recentOrders] = await db.query(`
      SELECT o.id, o.order_number, o.customer_name as customer, o.grand_total, o.status, DATE_FORMAT(o.order_date, '%Y-%m-%d') as order_date
      FROM orders o
      ORDER BY o.created_at DESC LIMIT 5
    `);

    // 4. Fetch top-selling products
    const [topSellingProducts] = await db.query(`
      SELECT p.id, p.name, p.code, p.image, SUM(combined.qty) as total_qty, SUM(combined.tot) as total_revenue
      FROM (
        SELECT product_id, quantity as qty, total as tot FROM sale_items
        UNION ALL
        SELECT product_id, quantity as qty, total as tot FROM order_items
      ) combined
      JOIN products p ON combined.product_id = p.id
      GROUP BY p.id, p.name, p.code, p.image
      ORDER BY total_qty DESC
      LIMIT 5
    `);

    // 5. Fetch dynamic 30-day sales and gross profit for dashboard chart
    const [dailyStats] = await db.query(`
      SELECT 
        DATE_FORMAT(s.sale_date, '%Y-%m-%d') as sale_date,
        SUM(s.grand_total) AS revenue,
        SUM(COALESCE((
            SELECT SUM(p.purchase_price * si.quantity)
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            WHERE si.sale_id = s.id
        ), 0)) AS cogs
      FROM sales s
      WHERE s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY s.sale_date
      ORDER BY s.sale_date ASC
    `);

    // Fetch dynamic 30-day e-commerce sales and gross profit for dashboard chart
    const [dailyEcomStats] = await db.query(`
      SELECT 
        DATE_FORMAT(o.order_date, '%Y-%m-%d') as order_date,
        SUM(o.grand_total) AS revenue,
        SUM(COALESCE((
            SELECT SUM(p.purchase_price * oi.quantity)
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = o.id
        ), 0)) AS cogs
      FROM orders o
      WHERE o.order_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND o.status != 'Cancelled'
      GROUP BY o.order_date
      ORDER BY o.order_date ASC
    `);

    // Organize 30 days of data cleanly combining store & e-commerce
    const statsMap = {};
    
    dailyStats.forEach(row => {
      statsMap[row.sale_date] = {
        revenue: parseFloat(row.revenue),
        profit: parseFloat(row.revenue) - parseFloat(row.cogs)
      };
    });

    dailyEcomStats.forEach(row => {
      if (statsMap[row.order_date]) {
        statsMap[row.order_date].revenue += parseFloat(row.revenue);
        statsMap[row.order_date].profit += parseFloat(row.revenue) - parseFloat(row.cogs);
      } else {
        statsMap[row.order_date] = {
          revenue: parseFloat(row.revenue),
          profit: parseFloat(row.revenue) - parseFloat(row.cogs)
        };
      }
    });

    const chartLabels = [];
    const chartRevenue = [];
    const chartProfit = [];

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      // Date label format: "DD MMM"
      const labelStr = `${dd} ${monthNames[d.getMonth()]}`;
      chartLabels.push(labelStr);

      if (statsMap[dateStr]) {
        chartRevenue.push(statsMap[dateStr].revenue);
        chartProfit.push(statsMap[dateStr].profit);
      } else {
        chartRevenue.push(0.0);
        chartProfit.push(0.0);
      }
    }

    res.json({
      success: true,
      counts: {
        invoices: parseInt(invoices),
        customers: parseInt(customers),
        suppliers: parseInt(suppliers),
        products: parseInt(products),
        purchases: parseFloat(purchases),
        sales: parseFloat(sales),
        low_stock: parseInt(low_stock),
        total_orders: parseInt(total_orders),
        pending_orders: parseInt(pending_orders),
        ecom_sales: parseFloat(ecom_sales),
        total_revenue: totalRevenue,
        profit: parseFloat(totalProfit.toFixed(2))
      },
      recentPurchases,
      recentSales,
      recentOrders,
      topSellingProducts,
      chart: {
        labels: chartLabels,
        revenue: chartRevenue,
        profit: chartProfit
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
