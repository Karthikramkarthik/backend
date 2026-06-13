const fs = require('fs');
const path = require('path');
const db = require('./config/database.js');
const productController = require('./controllers/productController.js');

(async () => {
  console.log('--- STARTING BULK IMPORT HEADER TEST ---');
  
  // 1. Create a mock CSV file omitting category, age, and sales price
  const csvPath = path.join(__dirname, 'test_import_temp.csv');
  const csvContent = 
    "Product Name,Product Code,Purchase Price,Initial Stock Quantity,Size\n" +
    "Import Test Product,IMP-TEST-99,120.50,25,L\n";
    
  fs.writeFileSync(csvPath, csvContent);
  console.log('Temporary CSV created at:', csvPath);

  // Clean up any pre-existing test product to prevent constraint errors
  await db.query('DELETE FROM products WHERE code = "IMP-TEST-99"');

  // 2. Mock Express Request & Response
  const req = {
    file: {
      path: csvPath,
      originalname: 'test_import_temp.csv'
    }
  };

  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };

  try {
    // 3. Call the import controller logic
    await productController.import(req, res);
    
    console.log('Response status code:', res.statusCode || 200);
    console.log('Response body:', res.body);

    if (res.statusCode && res.statusCode !== 200) {
      throw new Error(`Import failed with status ${res.statusCode}: ${JSON.stringify(res.body)}`);
    }

    // 4. Verify in Database that the product exists and has correct default/fallback values
    const [products] = await db.query('SELECT * FROM products WHERE code = "IMP-TEST-99" LIMIT 1');
    if (products.length === 0) {
      throw new Error('Product was not found in the database after import.');
    }

    const prod = products[0];
    console.log('Successfully imported product details from DB:', {
      id: prod.id,
      code: prod.code,
      name: prod.name,
      category_id: prod.category_id,
      age: prod.age,
      purchase_price: prod.purchase_price,
      sales_price: prod.sales_price,
      stock_quantity: prod.stock_quantity
    });

    // Assertions
    if (!prod.category_id) {
      throw new Error('Assertion failed: category_id should not be null (should map to General).');
    }
    if (prod.age !== null) {
      throw new Error(`Assertion failed: age should be null, got: ${prod.age}`);
    }
    if (parseFloat(prod.sales_price) !== 0.00) {
      throw new Error(`Assertion failed: sales_price should default to 0.00, got: ${prod.sales_price}`);
    }

    console.log('✔ ASSERTIONS PASSED: fallback values for missing Category, Age, and Sales Price are correct!');

    // 5. Clean up database and temp files
    await db.query('DELETE FROM products WHERE code = "IMP-TEST-99"');
    console.log('Test product IMP-TEST-99 deleted from DB.');
    console.log('--- TEST SUCCESSFULLY COMPLETED ---');
    process.exit(0);

  } catch (err) {
    console.error('❌ TEST FAILED:', err.message);
    if (fs.existsSync(csvPath)) {
      fs.unlinkSync(csvPath);
    }
    await db.query('DELETE FROM products WHERE code = "IMP-TEST-99"');
    process.exit(1);
  }
})();
