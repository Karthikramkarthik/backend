const db = require('./config/database.js');
const purchaseController = require('./controllers/purchaseController.js');

(async () => {
  console.log('--- STARTING MULTIPLE PURCHASES & IMMUTABILITY TEST ---');

  let supplierId = null;
  let productId = null;
  let purchaseId = null;

  try {
    // 1. Resolve / Create a category
    let categoryId = 1;
    const [categories] = await db.query('SELECT id FROM categories LIMIT 1');
    if (categories.length > 0) {
      categoryId = categories[0].id;
    } else {
      const [catResult] = await db.query('INSERT INTO categories (name, slug, status) VALUES ("Test Category", "test-cat", "active")');
      categoryId = catResult.insertId;
    }

    // 2. Create a mock supplier
    const [supResult] = await db.query(
      'INSERT INTO suppliers (name, mobile, address) VALUES ("Test Supplier 99", "9999999999", "123 Test St")'
    );
    supplierId = supResult.insertId;
    console.log('✔ Supplier created with ID:', supplierId);

    // 3. Create a mock product and variants
    const [prodResult] = await db.query(
      'INSERT INTO products (name, code, category_id, supplier_id, purchase_price, sales_price, stock_quantity, sizes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['Test Product 99', 'TST-PROD-99', categoryId, supplierId, 100.00, 150.00, 10, 'S, M']
    );
    productId = prodResult.insertId;
    console.log('✔ Product TST-PROD-99 created with ID:', productId);

    // Insert initial variants
    await db.query('INSERT INTO product_variants (product_id, size, stock_quantity) VALUES (?, ?, ?)', [productId, 'S', 5]);
    await db.query('INSERT INTO product_variants (product_id, size, stock_quantity) VALUES (?, ?, ?)', [productId, 'M', 5]);
    console.log('✔ Product variants S and M initialized with stock 5 each.');

    // 4. Test Purchase Creation (Mocking Express Req/Res)
    const reqCreate = {
      body: {
        supplier_id: supplierId,
        purchase_date: '2026-06-11',
        note: 'Procurement test notes',
        total_amount: 1500.00,
        invoice_number: 'TST-PUR-001',
        items: [
          { product_id: productId, size: 'S', quantity: 10, price: 100.00 },
          { product_id: productId, size: 'M', quantity: 5, price: 100.00 }
        ]
      }
    };

    const resCreate = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      }
    };

    await purchaseController.create(reqCreate, resCreate);

    if (resCreate.statusCode !== 201) {
      throw new Error(`Create purchase failed with code ${resCreate.statusCode}: ${JSON.stringify(resCreate.body)}`);
    }

    purchaseId = resCreate.body.purchaseId;
    console.log('✔ Purchase created successfully, purchaseId:', purchaseId);

    // Assertions: Verify in Database
    // Check purchase record
    const [purchases] = await db.query('SELECT * FROM purchases WHERE id = ? LIMIT 1', [purchaseId]);
    if (purchases.length === 0) {
      throw new Error('Assertion failed: Purchase record not found in database.');
    }
    if (purchases[0].invoice_number !== 'TST-PUR-001') {
      throw new Error(`Assertion failed: Expected invoice_number 'TST-PUR-001', got: ${purchases[0].invoice_number}`);
    }

    // Check purchase items
    const [pItems] = await db.query('SELECT * FROM purchase_items WHERE purchase_id = ?', [purchaseId]);
    if (pItems.length !== 2) {
      throw new Error(`Assertion failed: Expected 2 purchase items, got: ${pItems.length}`);
    }
    console.log('✔ Verified 2 purchase items saved successfully.');

    // Check variant stocks: S should be 5 + 10 = 15; M should be 5 + 5 = 10
    const [variantsS] = await db.query('SELECT stock_quantity FROM product_variants WHERE product_id = ? AND size = "S" LIMIT 1', [productId]);
    const [variantsM] = await db.query('SELECT stock_quantity FROM product_variants WHERE product_id = ? AND size = "M" LIMIT 1', [productId]);

    if (variantsS[0].stock_quantity !== 15) {
      throw new Error(`Assertion failed: Expected variant S stock = 15, got: ${variantsS[0].stock_quantity}`);
    }
    if (variantsM[0].stock_quantity !== 10) {
      throw new Error(`Assertion failed: Expected variant M stock = 10, got: ${variantsM[0].stock_quantity}`);
    }
    console.log('✔ Verified variant stocks: S = 15 (5+10), M = 10 (5+5).');

    // Check main product stock: should be 15 + 10 = 25
    const [products] = await db.query('SELECT stock_quantity FROM products WHERE id = ? LIMIT 1', [productId]);
    if (products[0].stock_quantity !== 25) {
      throw new Error(`Assertion failed: Expected main product stock = 25, got: ${products[0].stock_quantity}`);
    }
    console.log('✔ Verified main product stock = 25.');

    // Check inventory history
    const [history] = await db.query('SELECT * FROM inventory_history WHERE product_id = ? ORDER BY id DESC', [productId]);
    if (history.length < 2) {
      throw new Error(`Assertion failed: Expected inventory history entries, got: ${history.length}`);
    }
    console.log('✔ Verified inventory history logs registered.');

    // 5. Test Immutability - Try updating
    const reqUpdate = {
      params: { id: purchaseId },
      body: {
        supplier_id: supplierId,
        purchase_date: '2026-06-11',
        total_amount: 2000.00
      }
    };
    const resUpdate = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      }
    };

    await purchaseController.update(reqUpdate, resUpdate);
    if (resUpdate.statusCode !== 400 || !resUpdate.body.error.includes('immutable')) {
      throw new Error(`Assertion failed: Update should return 400 Bad Request with immutability error, got status ${resUpdate.statusCode} and body: ${JSON.stringify(resUpdate.body)}`);
    }
    console.log('✔ Verified: Update request rejected as expected (immutable).');

    // 6. Test Immutability - Try deleting
    const reqDelete = {
      params: { id: purchaseId }
    };
    const resDelete = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      }
    };

    await purchaseController.delete(reqDelete, resDelete);
    if (resDelete.statusCode !== 400 || !resDelete.body.error.includes('immutable')) {
      throw new Error(`Assertion failed: Delete should return 400 Bad Request with immutability error, got status ${resDelete.statusCode} and body: ${JSON.stringify(resDelete.body)}`);
    }
    console.log('✔ Verified: Delete request rejected as expected (immutable).');

    console.log('✔ ALL TEST ASSERTIONS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ TEST FAILED:', err.message);
    process.exit(1);
  } finally {
    // 7. Cleanup
    console.log('Cleaning up test data...');
    if (purchaseId) {
      // purchase_items will cascade delete when we delete the purchase
      // Wait, since we blocked delete in purchaseController, we must query DB directly to delete!
      await db.query('DELETE FROM purchase_items WHERE purchase_id = ?', [purchaseId]);
      await db.query('DELETE FROM purchases WHERE id = ?', [purchaseId]);
    }
    if (productId) {
      await db.query('DELETE FROM product_variants WHERE product_id = ?', [productId]);
      await db.query('DELETE FROM inventory_history WHERE product_id = ?', [productId]);
      await db.query('DELETE FROM products WHERE id = ?', [productId]);
    }
    if (supplierId) {
      await db.query('DELETE FROM suppliers WHERE id = ?', [supplierId]);
    }
    console.log('Cleanup complete.');
    process.exit(0);
  }
})();
