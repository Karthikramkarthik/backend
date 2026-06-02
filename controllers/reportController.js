const db = require('../config/database');

// Helper to fetch period financials
const fetchPeriodFinancialStats = async (startDate, endDate) => {
  // Sales & COGS
  const [[sales]] = await db.query(`
    SELECT 
      COALESCE(SUM(grand_total), 0) AS revenue,
      COALESCE(SUM((
          SELECT SUM(p.purchase_price * si.quantity)
          FROM sale_items si
          JOIN products p ON si.product_id = p.id
          WHERE si.sale_id = s.id
      )), 0) AS cogs
    FROM sales s
    WHERE s.sale_date BETWEEN ? AND ?
  `, [startDate, endDate]);

  // Purchases
  const [[{ purchases }]] = await db.query(`
    SELECT COALESCE(SUM(total_amount), 0) AS purchases 
    FROM purchases 
    WHERE purchase_date BETWEEN ? AND ?
  `, [startDate, endDate]);

  // Expenses
  const [[{ expenses }]] = await db.query(`
    SELECT COALESCE(SUM(amount), 0) AS expenses 
    FROM expenses 
    WHERE expense_date BETWEEN ? AND ?
  `, [startDate, endDate]);

  const revenue = parseFloat(sales.revenue || 0);
  const cogs = parseFloat(sales.cogs || 0);
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - parseFloat(expenses || 0);

  return {
    revenue,
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
    // 1. Generate 12-Month Financial Timeline Data
    const months = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setDate(1); // Set day to 1st to prevent month rollover anomalies (e.g. Feb 29/30/31 rolling over)
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

    // Fetch monthly sales and COGS
    const [salesTimeline] = await db.query(`
      SELECT 
        DATE_FORMAT(s.sale_date, '%Y-%m') AS month_key,
        SUM(s.grand_total) AS revenue,
        SUM(COALESCE((
            SELECT SUM(p.purchase_price * si.quantity)
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            WHERE si.sale_id = s.id
        ), 0)) AS cogs
      FROM sales s
      WHERE s.sale_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY month_key
    `);

    salesTimeline.forEach(row => {
      if (months[row.month_key]) {
        months[row.month_key].revenue = parseFloat(row.revenue);
        months[row.month_key].cogs = parseFloat(row.cogs);
        months[row.month_key].gross_profit = parseFloat(row.revenue) - parseFloat(row.cogs);
      }
    });

    // Fetch monthly purchases
    const [purchasesTimeline] = await db.query(`
      SELECT 
        DATE_FORMAT(purchase_date, '%Y-%m') AS month_key,
        SUM(total_amount) AS total_purchases
      FROM purchases
      WHERE purchase_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY month_key
    `);

    purchasesTimeline.forEach(row => {
      if (months[row.month_key]) {
        months[row.month_key].purchases = parseFloat(row.total_purchases);
      }
    });

    // Fetch monthly expenses
    const [expensesTimeline] = await db.query(`
      SELECT 
        DATE_FORMAT(expense_date, '%Y-%m') AS month_key,
        SUM(amount) AS total_expenses
      FROM expenses
      WHERE expense_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY month_key
    `);

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

    // 2. Period over Period Stats
    const today = new Date().toISOString().slice(0, 10);
    
    const yestDate = new Date();
    yestDate.setDate(yestDate.getDate() - 1);
    const yesterday = yestDate.toISOString().slice(0, 10);

    // This month dates
    const d = new Date();
    const thisMonthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const thisMonthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);

    // Last month dates
    const lastMonthD = new Date();
    lastMonthD.setMonth(lastMonthD.getMonth() - 1);
    const lastMonthStart = `${lastMonthD.getFullYear()}-${String(lastMonthD.getMonth() + 1).padStart(2, '0')}-01`;
    const lastMonthEnd = new Date(lastMonthD.getFullYear(), lastMonthD.getMonth() + 1, 0).toISOString().slice(0, 10);

    // This year dates
    const thisYearStart = `${d.getFullYear()}-01-01`;
    const thisYearEnd = `${d.getFullYear()}-12-31`;

    // Last year dates
    const lastYearStart = `${d.getFullYear() - 1}-01-01`;
    const lastYearEnd = `${d.getFullYear() - 1}-12-31`;

    const todayStats = await fetchPeriodFinancialStats(today, today);
    const yesterdayStats = await fetchPeriodFinancialStats(yesterday, yesterday);
    const thisMonthStats = await fetchPeriodFinancialStats(thisMonthStart, thisMonthEnd);
    const lastMonthStats = await fetchPeriodFinancialStats(lastMonthStart, lastMonthEnd);
    const thisYearStats = await fetchPeriodFinancialStats(thisYearStart, thisYearEnd);
    const lastYearStats = await fetchPeriodFinancialStats(lastYearStart, lastYearEnd);

    // 3. Top-selling products
    const [topSelling] = await db.query(`
      SELECT 
        p.code,
        p.name,
        c.name AS category_name,
        SUM(si.quantity) AS units_sold,
        SUM(si.total) AS total_revenue
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      GROUP BY p.id
      ORDER BY units_sold DESC
      LIMIT 10
    `);

    // 4. Slow-moving products (high stock, low sales)
    const [slowMoving] = await db.query(`
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
      LEFT JOIN sales s ON si.sale_id = s.id
      WHERE p.status = 'active'
      GROUP BY p.id
      ORDER BY units_sold ASC, p.stock_quantity DESC
      LIMIT 10
    `);

    // 5. Supplier Analytics
    const [supplierAnalytics] = await db.query(`
      SELECT 
        s.name AS supplier_name,
        COUNT(p.id) AS bills_count,
        SUM(p.total_amount) AS total_purchased,
        AVG(p.total_amount) AS avg_invoice
      FROM purchases p
      JOIN suppliers s ON p.supplier_id = s.id
      GROUP BY s.id
      ORDER BY total_purchased DESC
    `);

    // 6. Expense Breakdown by Category
    const [expenseCategories] = await db.query(`
      SELECT 
        category,
        SUM(amount) AS total_amount,
        COUNT(id) AS transaction_count
      FROM expenses
      GROUP BY category
      ORDER BY total_amount DESC
    `);

    // 7. Stock Report list
    const [stockReport] = await db.query(`
      SELECT p.code, p.name, c.name as category_name, p.stock_quantity, p.status 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.stock_quantity ASC
    `);

    // 8. Price Audit Log
    const [priceAudits] = await db.query(`
      SELECT * 
      FROM price_audit_log 
      ORDER BY id DESC
    `);

    // 9. All Product Sales list
    const [allProductSales] = await db.query(`
      SELECT 
        p.code,
        p.name,
        c.name AS category_name,
        COALESCE(SUM(si.quantity), 0) AS units_sold,
        COALESCE(SUM(si.total), 0) AS total_revenue
      FROM products p
      LEFT JOIN sale_items si ON p.id = si.product_id
      LEFT JOIN categories c ON p.category_id = c.id
      GROUP BY p.id
      ORDER BY units_sold DESC, total_revenue DESC
    `);

    // Calculate aggregated totals
    const [[{ totalSales }]] = await db.query('SELECT COALESCE(SUM(grand_total), 0) as totalSales FROM sales');
    const [[{ totalPurchases }]] = await db.query('SELECT COALESCE(SUM(total_amount), 0) as totalPurchases FROM purchases');
    const [[{ totalExpenses }]] = await db.query('SELECT COALESCE(SUM(amount), 0) as totalExpenses FROM expenses');

    res.json({
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
      allProductSales
    });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
