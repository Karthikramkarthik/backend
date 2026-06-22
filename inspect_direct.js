const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Manually parse .env
const envPath = path.join(__dirname, '.env');
const envConfig = fs.readFileSync(envPath, 'utf8')
  .split('\n')
  .reduce((acc, line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let value = match[2] ? match[2].trim() : '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      acc[match[1]] = value;
    }
    return acc;
  }, {});

(async () => {
  let connection;
  try {
    // Try socket path if EPERM or localhost
    const socketPath = '/Applications/MAMP/tmp/mysql/mysql.sock';
    const config = {
      user: envConfig.DB_USER || 'root',
      password: envConfig.DB_PASS || 'root',
      database: envConfig.DB_NAME || 'stock_management'
    };
    
    if (fs.existsSync(socketPath)) {
      console.log('Found MAMP mysql socket. Connecting via socket...');
      config.socketPath = socketPath;
    } else {
      console.log('Socket not found. Connecting via TCP localhost...');
      config.host = 'localhost';
      config.port = parseInt(envConfig.DB_PORT || '8889');
    }

    connection = await mysql.createConnection(config);
    
    console.log('Connected directly to database successfully!');
    
    const [salesColumns] = await connection.query('DESCRIBE sales');
    console.log('--- sales COLUMNS ---');
    console.log(JSON.stringify(salesColumns, null, 2));

    const [saleItemsColumns] = await connection.query('DESCRIBE sale_items');
    console.log('--- sale_items COLUMNS ---');
    console.log(JSON.stringify(saleItemsColumns, null, 2));

  } catch (err) {
    console.error('Error in direct inspect:', err);
  } finally {
    if (connection) await connection.end();
  }
})();
