const db = require('./config/database.js');

console.log('Migrations triggered by importing config/database.js.');
setTimeout(() => {
  console.log('Done.');
  process.exit(0);
}, 2000);
