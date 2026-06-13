const db = require('./config/database.js');

(async () => {
  try {
    const [columns] = await db.query('DESCRIBE purchases');
    console.log('--- COLUMNS ---');
    console.log(JSON.stringify(columns, null, 2));
    
    const [indexes] = await db.query('SHOW INDEX FROM purchases');
    console.log('--- INDEXES ---');
    console.log(JSON.stringify(indexes, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
