const db = require('../config/database');

let metricsCache = null;
let metricsCacheTime = 0;
const CACHE_DURATION = 15000; // 15 seconds cache duration

exports.getMetrics = async (req, res) => {
  try {
    const now = Date.now();
    if (metricsCache && (now - metricsCacheTime < CACHE_DURATION)) {
      return res.json(metricsCache);
    }

    // Run all database queries in parallel
    const [
      [[counts]],
      [[{ store_cogs }]],
      [[{ ecom_cogs }]],
      [recentPurchases],
      [recentSales],
      [recentOrders],
      [topSellingProducts],
      [dailyRevenueStats],
      [dailyCogsStats],
      [dailyEcomRevenueStats],
      [dailyEcomCogsStats]
    ] = await Promise.all([
      // 1. Consolidated count and sum stats
      db.query(`
        SELECT
          (SELECT count(*) FROM sales WHERE order_number IS NULL AND status NOT IN ('Cancelled', 'Revised', 'Superseded')) AS invoices,
          (SELECT count(*) FROM customers) AS customers,
          (SELECT count(*) FROM suppliers) AS suppliers,
          (SELECT COUNT(DISTINCT code) FROM products) AS products,
          (SELECT COALESCE(SUM(total_amount), 0) FROM purchases) AS purchases,
          (SELECT COALESCE(SUM(grand_total), 0) FROM sales WHERE order_number IS NULL AND status NOT IN ('Cancelled', 'Revised', 'Superseded')) AS sales,
          (SELECT COUNT(DISTINCT code) FROM products WHERE stock_quantity <= 10) AS low_stock,
          (SELECT count(*) FROM orders) AS total_orders,
          (SELECT count(*) FROM orders WHERE status = 'Pending') AS pending_orders,
          (SELECT COALESCE(SUM(grand_total), 0) FROM orders WHERE status NOT IN ('Cancelled', 'Returned')) AS ecom_sales,
          (SELECT COALESCE(SUM(shipping_charge), 0) FROM sales WHERE order_number IS NULL AND status NOT IN ('Cancelled', 'Revised', 'Superseded')) as store_shipping_val,
          (SELECT COALESCE(SUM(shipping_charge), 0) FROM orders WHERE status NOT IN ('Cancelled', 'Returned')) as ecom_shipping_val,
          (SELECT COALESCE(SUM(purchase_price * quantity), 0) FROM internal_consumptions) AS personal_usage_cost
      `),
      // 2. COGS for store sales
      db.query(`
        SELECT COALESCE(SUM(p.purchase_price * si.quantity), 0) AS store_cogs 
        FROM sale_items si 
        JOIN products p ON si.product_id = p.id
        JOIN sales s ON si.sale_id = s.id
        WHERE s.order_number IS NULL AND s.status NOT IN ('Cancelled', 'Revised', 'Superseded')
      `),
      // 3. COGS for e-commerce orders
      db.query(`
        SELECT COALESCE(SUM(p.purchase_price * oi.quantity), 0) AS ecom_cogs 
        FROM order_items oi 
        JOIN products p ON oi.product_id = p.id
        JOIN orders o ON oi.order_id = o.id
        WHERE o.status NOT IN ('Cancelled', 'Returned')
      `),
      // 4. Recent purchases
      db.query(`
        SELECT p.invoice_number, s.name as supplier, p.total_amount, DATE_FORMAT(p.purchase_date, '%Y-%m-%d') as purchase_date 
        FROM purchases p 
        JOIN suppliers s ON p.supplier_id = s.id 
        ORDER BY p.created_at DESC LIMIT 5
      `),
      // 5. Recent store sales
      db.query(`
        SELECT s.id, s.invoice_number, c.name as customer, s.grand_total, DATE_FORMAT(s.sale_date, '%Y-%m-%d') as sale_date 
        FROM sales s 
        JOIN customers c ON s.customer_id = c.id 
        WHERE s.order_number IS NULL AND s.status NOT IN ('Cancelled', 'Revised', 'Superseded')
        ORDER BY s.created_at DESC LIMIT 5
      `),
      // 6. Recent e-commerce orders
      db.query(`
        SELECT o.id, o.order_number, o.customer_name as customer, o.grand_total, o.status, DATE_FORMAT(o.order_date, '%Y-%m-%d') as order_date
        FROM orders o
        ORDER BY o.created_at DESC LIMIT 5
      `),
      // 7. Top-selling products
      db.query(`
        SELECT p.id, p.name, p.code, p.image, SUM(combined.qty) as total_qty, SUM(combined.tot) as total_revenue
        FROM (
          SELECT product_id, quantity as qty, total as tot FROM sale_items si JOIN sales s ON si.sale_id = s.id WHERE s.order_number IS NULL AND s.status NOT IN ('Cancelled', 'Revised', 'Superseded')
          UNION ALL
          SELECT product_id, quantity as qty, total as tot FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.status NOT IN ('Cancelled', 'Returned')
        ) combined
        JOIN products p ON combined.product_id = p.id
        GROUP BY p.id, p.name, p.code, p.image
        ORDER BY total_qty DESC
        LIMIT 5
      `),
      // 8. 30-day store daily revenue
      db.query(`
        SELECT DATE_FORMAT(sale_date, '%Y-%m-%d') as sale_date, SUM(grand_total) AS revenue
        FROM sales
        WHERE sale_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND order_number IS NULL AND status NOT IN ('Cancelled', 'Revised', 'Superseded')
        GROUP BY sale_date
      `),
      // 9. 30-day store daily cogs
      db.query(`
        SELECT DATE_FORMAT(s.sale_date, '%Y-%m-%d') as sale_date, SUM(p.purchase_price * si.quantity) AS cogs
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        WHERE s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND s.order_number IS NULL AND s.status NOT IN ('Cancelled', 'Revised', 'Superseded')
        GROUP BY s.sale_date
      `),
      // 10. 30-day ecom daily revenue
      db.query(`
        SELECT DATE_FORMAT(order_date, '%Y-%m-%d') as order_date, SUM(grand_total) AS revenue
        FROM orders
        WHERE order_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND status NOT IN ('Cancelled', 'Returned')
        GROUP BY order_date
      `),
      // 11. 30-day ecom daily cogs
      db.query(`
        SELECT DATE_FORMAT(o.order_date, '%Y-%m-%d') as order_date, SUM(p.purchase_price * oi.quantity) AS cogs
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        JOIN products p ON oi.product_id = p.id
        WHERE o.order_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND o.status NOT IN ('Cancelled', 'Returned')
        GROUP BY o.order_date
      `)
    ]);

    const {
      invoices,
      customers,
      suppliers,
      products,
      purchases,
      sales,
      low_stock,
      total_orders,
      pending_orders,
      ecom_sales,
      store_shipping_val,
      ecom_shipping_val,
      personal_usage_cost
    } = counts;

    const store_shipping = parseFloat(store_shipping_val || 0);
    const ecom_shipping = parseFloat(ecom_shipping_val || 0);
    const totalShipping = store_shipping + ecom_shipping;

    const totalRevenue = parseFloat(sales) + parseFloat(ecom_sales);
    const totalProfit = parseFloat(sales) - store_shipping + parseFloat(ecom_sales) - ecom_shipping - parseFloat(store_cogs) - parseFloat(ecom_cogs);

    // Merge daily stats without correlated subqueries
    const statsMap = {};

    dailyRevenueStats.forEach(row => {
      statsMap[row.sale_date] = {
        revenue: parseFloat(row.revenue),
        cogs: 0.0
      };
    });

    dailyCogsStats.forEach(row => {
      if (statsMap[row.sale_date]) {
        statsMap[row.sale_date].cogs = parseFloat(row.cogs);
      } else {
        statsMap[row.sale_date] = {
          revenue: 0.0,
          cogs: parseFloat(row.cogs)
        };
      }
    });

    // Merge ecom daily stats
    const ecomStatsMap = {};
    dailyEcomRevenueStats.forEach(row => {
      ecomStatsMap[row.order_date] = {
        revenue: parseFloat(row.revenue),
        cogs: 0.0
      };
    });

    dailyEcomCogsStats.forEach(row => {
      if (ecomStatsMap[row.order_date]) {
        ecomStatsMap[row.order_date].cogs = parseFloat(row.cogs);
      } else {
        ecomStatsMap[row.order_date] = {
          revenue: 0.0,
          cogs: parseFloat(row.cogs)
        };
      }
    });

    // Combine both store and ecom daily metrics
    const combinedStatsMap = {};
    const allDates = new Set([...Object.keys(statsMap), ...Object.keys(ecomStatsMap)]);
    
    allDates.forEach(date => {
      const storeRev = statsMap[date] ? statsMap[date].revenue : 0;
      const storeCogs = statsMap[date] ? statsMap[date].cogs : 0;
      const ecomRev = ecomStatsMap[date] ? ecomStatsMap[date].revenue : 0;
      const ecomCogs = ecomStatsMap[date] ? ecomStatsMap[date].cogs : 0;

      combinedStatsMap[date] = {
        revenue: storeRev + ecomRev,
        profit: (storeRev + ecomRev) - (storeCogs + ecomCogs)
      };
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

      if (combinedStatsMap[dateStr]) {
        chartRevenue.push(combinedStatsMap[dateStr].revenue);
        chartProfit.push(combinedStatsMap[dateStr].profit);
      } else {
        chartRevenue.push(0.0);
        chartProfit.push(0.0);
      }
    }

    const jsonResponse = {
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
        profit: parseFloat(totalProfit.toFixed(2)),
        store_shipping: store_shipping,
        ecom_shipping: ecom_shipping,
        total_shipping: totalShipping,
        personal_usage_cost: parseFloat(personal_usage_cost || 0)
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
    };

    // Store in cache
    metricsCache = jsonResponse;
    metricsCacheTime = now;

    res.json(jsonResponse);
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

