const db = require('./config/database.js');

(async () => {
  try {
    const [columns] = await db.query('DESCRIBE products');
    console.log(JSON.stringify(columns, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error describing table:', err);
    process.exit(1);
  }
})();
