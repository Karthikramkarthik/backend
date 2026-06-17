const mysql = require('mysql2/promise');

(async () => {
  try {
    const connection = await mysql.createConnection({
      host: '127.0.0.1',
      port: 8889,
      user: 'root',
      password: 'root',
      database: 'stock_management'
    });

    console.log('Connected to MySQL successfully using 127.0.0.1.');

    const tables = ['categories', 'products', 'suppliers', 'purchases', 'customers', 'expenses', 'coupons'];
    for (const table of tables) {
      const [columns] = await connection.query(`DESCRIBE \`${table}\``);
      const auditCols = columns.filter(c => 
        ['created_by_user_id', 'created_by_name', 'created_by_role', 'created_at'].includes(c.Field)
      );
      console.log(`Table: ${table}`);
      console.log(JSON.stringify(auditCols, null, 2));
    }

    await connection.end();
    process.exit(0);
  } catch (err) {
    console.error('Connection/Query error:', err.message);
    process.exit(1);
  }
})();
