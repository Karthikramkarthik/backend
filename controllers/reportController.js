const db = require('../config/database');

let reportsCache = null;
let reportsCacheTime = 0;
const CACHE_DURATION = 15000; // 15 seconds cache duration

// Helper to fetch period financials
const fetchPeriodFinancialStats = async (startDate, endDate) => {
  const [
    [[{ revenue }]],
    [[{ cogs }]],
    [[{ purchases }]],
    [[{ expenses }]]
  ] = await Promise.all([
    // Sales Revenue
    db.query(`
      SELECT COALESCE(SUM(grand_total), 0) AS revenue
      FROM sales
      WHERE (sale_date BETWEEN ? AND ?) AND status NOT IN ('Cancelled', 'Revised', 'Superseded')
    `, [startDate, endDate]),
    // Sales COGS
    db.query(`
      SELECT COALESCE(SUM(p.purchase_price * si.quantity), 0) AS cogs
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      WHERE (s.sale_date BETWEEN ? AND ?) AND s.status NOT IN ('Cancelled', 'Revised', 'Superseded')
    `, [startDate, endDate]),
    // Purchases
    db.query(`
      SELECT COALESCE(SUM(total_amount), 0) AS purchases 
      FROM purchases 
      WHERE purchase_date BETWEEN ? AND ?
    `, [startDate, endDate]),
    // Expenses
    db.query(`
      SELECT COALESCE(SUM(amount), 0) AS expenses 
      FROM expenses 
      WHERE expense_date BETWEEN ? AND ?
    `, [startDate, endDate])
  ]);

  const grossProfit = parseFloat(revenue || 0) - parseFloat(cogs || 0);
  const netProfit = grossProfit - parseFloat(expenses || 0);

  return {
    revenue: parseFloat(revenue || 0),
    net_profit: netProfit,
    purchases: parseFloat(purchases || 0),
    expenses: parseFloat(expenses || 0)
  };
};

const calculatePercentageGrowth = (current, previous) => {
  if (previous <= 0) {
    return current > 0 ? 100.0 : 0.0;
  }
  return ((current - previous) / previous) * 100;
};

exports.getReports = async (req, res) => {
  try {
    const now = Date.now();
    if (reportsCache && (now - reportsCacheTime < CACHE_DURATION)) {
      return res.json(reportsCache);
    }

    // 1. Generate 12-Month Financial Timeline Data structure
    const months = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setDate(1); // Set day to 1st to prevent month rollover anomalies
      d.setMonth(d.getMonth() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const monthKey = `${yyyy}-${mm}`;
      const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
      
      months[monthKey] = {
        label,
        revenue: 0.0,
        cogs: 0.0,
        gross_profit: 0.0,
        purchases: 0.0,
        expenses: 0.0,
        net_profit: 0.0
      };
    }

    const today = new Date().toISOString().slice(0, 10);
    const yestDate = new Date();
    yestDate.setDate(yestDate.getDate() - 1);
    const yesterday = yestDate.toISOString().slice(0, 10);

    const d = new Date();
    const thisMonthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const thisMonthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);

    const lastMonthD = new Date();
    lastMonthD.setMonth(lastMonthD.getMonth() - 1);
    const lastMonthStart = `${lastMonthD.getFullYear()}-${String(lastMonthD.getMonth() + 1).padStart(2, '0')}-01`;
    const lastMonthEnd = new Date(lastMonthD.getFullYear(), lastMonthD.getMonth() + 1, 0).toISOString().slice(0, 10);

    const thisYearStart = `${d.getFullYear()}-01-01`;
    const thisYearEnd = `${d.getFullYear()}-12-31`;

    const lastYearStart = `${d.getFullYear() - 1}-01-01`;
    const lastYearEnd = `${d.getFullYear() - 1}-12-31`;

    // Fetch all analytics components in parallel
    const [
      [
        todayStats,
        yesterdayStats,
        thisMonthStats,
        lastMonthStats,
        thisYearStats,
        lastYearStats
      ],
      [
        salesRevenueTimeline,
        salesCogsTimeline,
        purchasesTimeline,
        expensesTimeline
      ],
      [topSelling],
      [slowMoving],
      [supplierAnalytics],
      [expenseCategories],
      [stockReport],
      [priceAudits],
      [allProductSales],
      [[{ totalSales }]],
      [[{ totalPurchases }]],
      [[{ totalExpenses }]],
      [personalUsage]
    ] = await Promise.all([
      // A. Period stats
      Promise.all([
        fetchPeriodFinancialStats(today, today),
        fetchPeriodFinancialStats(yesterday, yesterday),
        fetchPeriodFinancialStats(thisMonthStart, thisMonthEnd),
        fetchPeriodFinancialStats(lastMonthStart, lastMonthEnd),
        fetchPeriodFinancialStats(thisYearStart, thisYearEnd),
        fetchPeriodFinancialStats(lastYearStart, lastYearEnd)
      ]),
      // B. Monthly timeline queries without correlated subqueries
      Promise.all([
        db.query(`
          SELECT DATE_FORMAT(sale_date, '%Y-%m') AS month_key, SUM(grand_total) AS revenue
          FROM sales
          WHERE sale_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) AND status NOT IN ('Cancelled', 'Revised', 'Superseded')
          GROUP BY month_key
        `),
        db.query(`
          SELECT DATE_FORMAT(s.sale_date, '%Y-%m') AS month_key, SUM(p.purchase_price * si.quantity) AS cogs
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_id = p.id
          WHERE s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) AND s.status NOT IN ('Cancelled', 'Revised', 'Superseded')
          GROUP BY month_key
        `),
        db.query(`
          SELECT DATE_FORMAT(purchase_date, '%Y-%m') AS month_key, SUM(total_amount) AS total_purchases
          FROM purchases
          WHERE purchase_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
          GROUP BY month_key
        `),
        db.query(`
          SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month_key, SUM(amount) AS total_expenses
          FROM expenses
          WHERE expense_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
          GROUP BY month_key
        `)
      ]),
      // C. Top-selling products
      db.query(`
        SELECT 
          p.code,
          p.name,
          c.name AS category_name,
          SUM(si.quantity) AS units_sold,
          SUM(si.total) AS total_revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE s.status NOT IN ('Cancelled', 'Revised', 'Superseded')
        GROUP BY p.id
        ORDER BY units_sold DESC
        LIMIT 10
      `),
      // D. Slow moving products
      db.query(`
        SELECT 
          p.code,
          p.name,
          c.name AS category_name,
          p.stock_quantity,
          p.purchase_price,
          (p.stock_quantity * p.purchase_price) AS capital_locked,
          COALESCE(SUM(si.quantity), 0) AS units_sold,
          DATE_FORMAT(MAX(s.sale_date), '%Y-%m-%d') AS last_sold
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN sale_items si ON p.id = si.product_id
        LEFT JOIN sales s ON si.sale_id = s.id AND s.status NOT IN ('Cancelled', 'Revised', 'Superseded')
        WHERE p.status = 'active'
        GROUP BY p.id
        ORDER BY units_sold ASC, p.stock_quantity DESC
        LIMIT 10
      `),
      // E. Supplier analytics
      db.query(`
        SELECT 
          s.name AS supplier_name,
          COUNT(p.id) AS bills_count,
          SUM(p.total_amount) AS total_purchased,
          AVG(p.total_amount) AS avg_invoice
        FROM purchases p
        JOIN suppliers s ON p.supplier_id = s.id
        GROUP BY s.id
        ORDER BY total_purchased DESC
      `),
      // F. Expense categories
      db.query(`
        SELECT 
          category,
          SUM(amount) AS total_amount,
          COUNT(id) AS transaction_count
        FROM expenses
        GROUP BY category
        ORDER BY total_amount DESC
      `),
      // G. Stock report
      db.query(`
        SELECT p.code, p.name, c.name as category_name, p.stock_quantity, p.initial_stock_quantity, p.status 
        FROM products p 
        LEFT JOIN categories c ON p.category_id = c.id
        ORDER BY p.stock_quantity ASC
      `),
      // H. Price audits
      db.query(`
        SELECT * 
        FROM price_audit_log 
        ORDER BY id DESC
      `),
      // I. All product sales
      db.query(`
        SELECT 
          p.code,
          p.name,
          c.name AS category_name,
          COALESCE(SUM(si.quantity), 0) AS units_sold,
          COALESCE(SUM(si.total), 0) AS total_revenue
        FROM products p
        LEFT JOIN (
          SELECT si.product_id, si.quantity, si.total 
          FROM sale_items si 
          JOIN sales s ON si.sale_id = s.id 
          WHERE s.status NOT IN ('Cancelled', 'Revised', 'Superseded')
        ) si ON p.id = si.product_id
        LEFT JOIN categories c ON p.category_id = c.id
        GROUP BY p.id
        ORDER BY units_sold DESC, total_revenue DESC
      `),
      // J. Aggregated totals
      db.query("SELECT COALESCE(SUM(grand_total), 0) as totalSales FROM sales WHERE status NOT IN ('Cancelled', 'Revised', 'Superseded')"),
      db.query('SELECT COALESCE(SUM(total_amount), 0) as totalPurchases FROM purchases'),
      db.query('SELECT COALESCE(SUM(amount), 0) as totalExpenses FROM expenses'),
      // K. Personal Usage Report
      db.query(`
        SELECT 
          ic.id,
          p.name AS product_name,
          p.code AS product_code,
          ic.size,
          ic.quantity,
          ic.purchase_price,
          (ic.purchase_price * ic.quantity) AS usage_cost,
          DATE_FORMAT(ic.usage_date, '%Y-%m-%d') AS usage_date,
          ic.used_by,
          ic.reason,
          ic.notes
        FROM internal_consumptions ic
        JOIN products p ON ic.product_id = p.id
        ORDER BY ic.usage_date DESC, ic.created_at DESC
      `)
    ]);

    // Map the timeline datasets
    salesRevenueTimeline.forEach(row => {
      if (months[row.month_key]) {
        months[row.month_key].revenue = parseFloat(row.revenue);
      }
    });

    salesCogsTimeline.forEach(row => {
      if (months[row.month_key]) {
        months[row.month_key].cogs = parseFloat(row.cogs);
        months[row.month_key].gross_profit = months[row.month_key].revenue - parseFloat(row.cogs);
      }
    });

    purchasesTimeline.forEach(row => {
      if (months[row.month_key]) {
        months[row.month_key].purchases = parseFloat(row.total_purchases);
      }
    });

    expensesTimeline.forEach(row => {
      if (months[row.month_key]) {
        months[row.month_key].expenses = parseFloat(row.total_expenses);
      }
    });

    // Compile timeline arrays
    const timelineLabels = [];
    const timelineRevenue = [];
    const timelineGrossProfit = [];
    const timelineNetProfit = [];
    const timelinePurchases = [];
    const timelineExpenses = [];
    const timelineOutgoings = [];

    Object.keys(months).forEach(key => {
      const data = months[key];
      data.net_profit = data.gross_profit - data.expenses;

      timelineLabels.push(data.label);
      timelineRevenue.push(data.revenue);
      timelineGrossProfit.push(data.gross_profit);
      timelineNetProfit.push(data.net_profit);
      timelinePurchases.push(data.purchases);
      timelineExpenses.push(data.expenses);
      timelineOutgoings.push(data.purchases + data.expenses);
    });

    const jsonResponse = {
      success: true,
      totals: {
        sales: parseFloat(totalSales),
        purchases: parseFloat(totalPurchases),
        expenses: parseFloat(totalExpenses),
        netProfit: parseFloat(totalSales) - parseFloat(totalPurchases) - parseFloat(totalExpenses)
      },
      timeline: {
        labels: timelineLabels,
        revenue: timelineRevenue,
        grossProfit: timelineGrossProfit,
        netProfit: timelineNetProfit,
        purchases: timelinePurchases,
        expenses: timelineExpenses,
        outgoings: timelineOutgoings
      },
      periodStats: {
        today: todayStats,
        yesterday: yesterdayStats,
        thisMonth: thisMonthStats,
        lastMonth: lastMonthStats,
        thisYear: thisYearStats,
        lastYear: lastYearStats,
        growth: {
          dailyRevenue: calculatePercentageGrowth(todayStats.revenue, yesterdayStats.revenue),
          dailyProfit: calculatePercentageGrowth(todayStats.net_profit, yesterdayStats.net_profit),
          monthlyRevenue: calculatePercentageGrowth(thisMonthStats.revenue, lastMonthStats.revenue),
          monthlyProfit: calculatePercentageGrowth(thisMonthStats.net_profit, lastMonthStats.net_profit),
          yearlyRevenue: calculatePercentageGrowth(thisYearStats.revenue, lastYearStats.revenue),
          yearlyProfit: calculatePercentageGrowth(thisYearStats.net_profit, lastYearStats.net_profit)
        }
      },
      topSelling,
      slowMoving,
      supplierAnalytics,
      expenseCategories,
      stockReport,
      priceAudits,
      allProductSales,
      personalUsage
    };

    // Store in cache
    reportsCache = jsonResponse;
    reportsCacheTime = now;

    res.json(jsonResponse);
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

  


exports.customersByProduct = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    let posWhere = [];
    let posParams = [];
    let ecomWhere = ["o.status != 'Cancelled'", "o.status != 'Returned'", "o.invoice_number IS NULL"];
    let ecomParams = [];

    // Filter by Product Name or Category
    if (req.query.product) {
      posWhere.push('(p.name LIKE ? OR cat.name LIKE ?)');
      posParams.push('%' + req.query.product + '%', '%' + req.query.product + '%');

      ecomWhere.push('(p.name LIKE ? OR cat.name LIKE ?)');
      ecomParams.push('%' + req.query.product + '%', '%' + req.query.product + '%');
    }

    // Filter by Customer Name or Mobile
    if (req.query.customer) {
      posWhere.push('(c.name LIKE ? OR c.mobile LIKE ?)');
      posParams.push('%' + req.query.customer + '%', '%' + req.query.customer + '%');

      ecomWhere.push('(o.customer_name LIKE ? OR o.customer_mobile LIKE ?)');
      ecomParams.push('%' + req.query.customer + '%', '%' + req.query.customer + '%');
    }

    // Filter by Date Range
    if (req.query.dateStart) {
      posWhere.push('s.sale_date >= ?');
      posParams.push(req.query.dateStart);

      ecomWhere.push('o.order_date >= ?');
      ecomParams.push(req.query.dateStart);
    }
    if (req.query.dateEnd) {
      posWhere.push('s.sale_date <= ?');
      posParams.push(req.query.dateEnd);

      ecomWhere.push('o.order_date <= ?');
      ecomParams.push(req.query.dateEnd);
    }

    const posWhereStr = posWhere.length > 0 ? ' AND ' + posWhere.join(' AND ') : '';
    const ecomWhereStr = ecomWhere.length > 0 ? ' AND ' + ecomWhere.join(' AND ') : '';

    // 1. Get totals and overall statistics
    const summaryQuery = `
      SELECT 
        COUNT(DISTINCT mobile) AS total_customers,
        SUM(total_amount) AS total_revenue
      FROM (
        SELECT 
          c.mobile AS mobile,
          si.total AS total_amount
        FROM sales s
        JOIN sale_items si ON s.id = si.sale_id
        JOIN products p ON si.product_id = p.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        JOIN customers c ON s.customer_id = c.id
        WHERE s.status NOT IN ('Cancelled', 'Revised', 'Superseded') ${posWhereStr}
        
        UNION ALL
        
        SELECT 
          o.customer_mobile AS mobile,
          oi.total AS total_amount
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN products p ON oi.product_id = p.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        WHERE 1=1 ${ecomWhereStr}
      ) AS combined
    `;

    const summaryParams = [...posParams, ...ecomParams];
    const [[summary]] = await db.query(summaryQuery, summaryParams);

    const totalCustomers = summary ? (summary.total_customers || 0) : 0;
    const totalRevenue = summary ? parseFloat(summary.total_revenue || 0) : 0;

    // 2. Get paginated customer records
    const listQuery = `
      SELECT 
        mobile,
        MIN(customer_name) AS customer_name,
        MIN(customer_email) AS customer_email,
        MIN(source) AS source,
        COUNT(DISTINCT transaction_id) AS total_orders,
        SUM(quantity) AS total_quantity,
        SUM(total_amount) AS total_amount,
        MAX(purchase_date) AS last_purchase_date
      FROM (
        SELECT 
          c.mobile AS mobile,
          c.name AS customer_name,
          c.email AS customer_email,
          c.source AS source,
          CONCAT('pos_', s.id) AS transaction_id,
          si.quantity AS quantity,
          si.total AS total_amount,
          s.sale_date AS purchase_date
        FROM sales s
        JOIN sale_items si ON s.id = si.sale_id
        JOIN products p ON si.product_id = p.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        JOIN customers c ON s.customer_id = c.id
        WHERE s.status NOT IN ('Cancelled', 'Revised', 'Superseded') ${posWhereStr}
        
        UNION ALL
        
        SELECT 
          o.customer_mobile AS mobile,
          o.customer_name AS customer_name,
          o.customer_email AS customer_email,
          'Website' AS source,
          CONCAT('ecom_', o.id) AS transaction_id,
          oi.quantity AS quantity,
          oi.total AS total_amount,
          o.order_date AS purchase_date
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN products p ON oi.product_id = p.id
        LEFT JOIN categories cat ON p.category_id = cat.id
        WHERE 1=1 ${ecomWhereStr}
      ) AS combined
      GROUP BY mobile
      ORDER BY total_amount DESC
      LIMIT ? OFFSET ?
    `;

    const listParams = [...posParams, ...ecomParams, limit, offset];
    const [customers] = await db.query(listQuery, listParams);

    res.json({
      success: true,
      summary: {
        totalCustomers,
        totalRevenue
      },
      customers,
      pagination: {
        page,
        limit,
        totalCustomers
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.customerPurchaseHistory = async (req, res) => {
  try {
    const { customerId } = req.params;
    
    let mobile = customerId;
    let customerName = '';
    let customerEmail = '';

    let cust;
    const isId = /^\d+$/.test(customerId);
    if (isId && customerId.length <= 6) {
      const [rows] = await db.query('SELECT name, mobile, email FROM customers WHERE id = ?', [customerId]);
      if (rows && rows.length > 0) {
        cust = rows[0];
      }
    }
    
    if (!cust) {
      const [rows] = await db.query('SELECT name, mobile, email FROM customers WHERE mobile = ?', [customerId]);
      if (rows && rows.length > 0) {
        cust = rows[0];
      }
    }

    if (cust) {
      mobile = cust.mobile;
      customerName = cust.name;
      customerEmail = cust.email;
    }

    // POS sales
    const [posSales] = await db.query(`
      SELECT s.id, s.invoice_number, s.payment_method, s.subtotal, s.discount, s.gst_amount, s.shipping_charge, s.grand_total, 
             DATE_FORMAT(s.sale_date, '%Y-%m-%d') as date, 
             CASE WHEN s.order_number IS NOT NULL THEN 'E-Commerce' ELSE 'POS' END as channel, 
             s.status
      FROM sales s
      JOIN customers c ON s.customer_id = c.id
      WHERE c.mobile = ?
      ORDER BY s.sale_date DESC
    `, [mobile]);

    const isAdminOrOwner = req.user && (req.user.role === 'Owner' || req.user.role === 'Admin');

    for (let sale of posSales) {
      const [items] = await db.query(`
        SELECT si.id, si.quantity, si.rate as price, si.total, si.size, p.name as product_name, p.code as product_code${isAdminOrOwner ? ', p.purchase_price as cost_price' : ''}
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        WHERE si.sale_id = ?
      `, [sale.id]);

      if (isAdminOrOwner) {
        let totalProfit = 0;
        for (let item of items) {
          const costPrice = parseFloat(item.cost_price) || 0;
          const sellingPrice = parseFloat(item.price) || 0;
          const quantity = parseFloat(item.quantity) || 0;

          item.profit = (sellingPrice - costPrice) * quantity;
          item.profit_percent = (costPrice > 0 && quantity > 0) ? (item.profit / (costPrice * quantity)) * 100 : 0;
          totalProfit += item.profit;
        }
        sale.total_profit = totalProfit;
      }

      sale.items = items;
    }

    // E-commerce orders
    const [ecomOrders] = await db.query(`
      SELECT o.id, o.order_number as invoice_number, o.payment_method, o.subtotal, o.discount, o.gst_amount, o.shipping_charge, o.grand_total,
             DATE_FORMAT(o.order_date, '%Y-%m-%d') as date, 'E-Commerce' as channel, o.status,
             o.customer_name, o.customer_email
      FROM orders o
      WHERE o.customer_mobile = ? AND o.invoice_number IS NULL
      ORDER BY o.order_date DESC
    `, [mobile]);

    for (let order of ecomOrders) {
      const [items] = await db.query(`
        SELECT oi.id, oi.quantity, oi.price, oi.total, oi.size, oi.color, p.name as product_name, p.code as product_code${isAdminOrOwner ? ', p.purchase_price as cost_price' : ''}
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [order.id]);

      if (isAdminOrOwner) {
        let totalProfit = 0;
        for (let item of items) {
          const costPrice = parseFloat(item.cost_price) || 0;
          const sellingPrice = parseFloat(item.price) || 0;
          const quantity = parseFloat(item.quantity) || 0;

          item.profit = (sellingPrice - costPrice) * quantity;
          item.profit_percent = (costPrice > 0 && quantity > 0) ? (item.profit / (costPrice * quantity)) * 100 : 0;
          totalProfit += item.profit;
        }
        order.total_profit = totalProfit;
      }

      order.items = items;
      if (!customerName && order.customer_name) {
        customerName = order.customer_name;
      }
      if (!customerEmail && order.customer_email) {
        customerEmail = order.customer_email;
      }
    }

    const history = [...posSales, ...ecomOrders];
    history.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      success: true,
      customer: {
        name: customerName || 'Guest Customer',
        mobile: mobile,
        email: customerEmail || 'N/A'
      },
      history
    });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

