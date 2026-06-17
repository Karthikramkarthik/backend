const db = require('./config/database.js');

(async () => {
  try {
    const [salesColumns] = await db.query('DESCRIBE sales');
    console.log('--- sales COLUMNS ---');
    console.log(JSON.stringify(salesColumns, null, 2));
    
    const [saleItemsColumns] = await db.query('DESCRIBE sale_items');
    console.log('--- sale_items COLUMNS ---');
    console.log(JSON.stringify(saleItemsColumns, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
