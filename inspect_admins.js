const db = require('./config/database.js');

(async () => {
  try {
    const [admins] = await db.query('SELECT * FROM admins');
    console.log(JSON.stringify(admins, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error selecting from table admins:', err);
    process.exit(1);
  }
})();
