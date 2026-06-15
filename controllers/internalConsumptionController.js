const db = require('../config/database');

// Create a new consumption record
exports.create = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { product_id, size, quantity, usage_date, used_by, reason, notes } = req.body;

    if (!product_id || !quantity || !usage_date || !used_by || !reason) {
      return res.status(400).json({ error: 'Please enter all required fields' });
    }

    const productId = parseInt(product_id);
    const qty = parseInt(quantity);

    if (isNaN(productId) || isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Invalid product ID or quantity' });
    }

    // 1. Check product exists and get its current stock / prices
    const [products] = await connection.query(
      'SELECT name, code, purchase_price, sales_price, stock_quantity FROM products WHERE id = ? LIMIT 1',
      [productId]
    );

    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = products[0];

    // 2. If size variant is specified, validate stock in product_variants
    if (size) {
      const [variants] = await connection.query(
        'SELECT stock_quantity FROM product_variants WHERE product_id = ? AND LOWER(size) = LOWER(?) LIMIT 1',
        [productId, size]
      );

      if (variants.length === 0) {
        return res.status(400).json({ error: `Product variant size '${size}' not found` });
      }

      if (variants[0].stock_quantity < qty) {
        return res.status(400).json({ 
          error: `Insufficient variant stock. Available: ${variants[0].stock_quantity}, Requested: ${qty}` 
        });
      }

      // Deduct from variant stock
      await connection.query(
        'UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE product_id = ? AND LOWER(size) = LOWER(?)',
        [qty, productId, size]
      );
    } else {
      // If no variant is specified, check general stock
      if (product.stock_quantity < qty) {
        return res.status(400).json({ 
          error: `Insufficient general stock. Available: ${product.stock_quantity}, Requested: ${qty}` 
        });
      }
    }

    // 3. Deduct from general product inventory
    await connection.query(
      'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
      [qty, productId]
    );

    // 4. Save internal consumption record
    const [result] = await connection.query(
      `INSERT INTO internal_consumptions 
       (product_id, size, quantity, purchase_price, sales_price, usage_date, used_by, reason, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        size || null,
        qty,
        product.purchase_price,
        product.sales_price,
        usage_date,
        used_by,
        reason,
        notes || null
      ]
    );

    const consumptionId = result.insertId;

    // 5. Log in inventory_history
    const historyNotes = `Reason: ${reason}. Used by: ${used_by}. Notes: ${notes || ''}`;
    await connection.query(
      `INSERT INTO inventory_history (product_id, change_quantity, action_type, reference_id, reference_number, notes) 
       VALUES (?, ?, 'internal_consumption', ?, ?, ?)`,
      [
        productId,
        -qty, // deduction
        consumptionId,
        `CON-${consumptionId.toString().padStart(5, '0')}`,
        historyNotes.substring(0, 255)
      ]
    );

    await connection.commit();
    res.status(201).json({
      success: true,
      message: 'Internal consumption recorded successfully!',
      consumptionId
    });

  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    connection.release();
  }
};

// List consumption records
exports.list = async (req, res) => {
  try {
    const [logs] = await db.query(`
      SELECT ic.*, p.name as product_name, p.code as product_code,
             DATE_FORMAT(ic.usage_date, '%Y-%m-%d') as usage_date
      FROM internal_consumptions ic
      JOIN products p ON ic.product_id = p.id
      ORDER BY ic.usage_date DESC, ic.created_at DESC
    `);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Delete (restore) a consumption record
exports.delete = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;

    // Fetch the consumption record
    const [records] = await connection.query(
      'SELECT * FROM internal_consumptions WHERE id = ? LIMIT 1',
      [id]
    );

    if (records.length === 0) {
      return res.status(404).json({ error: 'Consumption record not found' });
    }

    const record = records[0];

    // 1. Restore stock in general products table
    await connection.query(
      'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
      [record.quantity, record.product_id]
    );

    // 2. Restore stock in variants if size was specified
    if (record.size) {
      // Ensure the variant exists or insert it back
      const [variants] = await connection.query(
        'SELECT id FROM product_variants WHERE product_id = ? AND LOWER(size) = LOWER(?) LIMIT 1',
        [record.product_id, record.size]
      );

      if (variants.length > 0) {
        await connection.query(
          'UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?',
          [record.quantity, variants[0].id]
        );
      } else {
        await connection.query(
          'INSERT INTO product_variants (product_id, size, stock_quantity) VALUES (?, ?, ?)',
          [record.product_id, record.size, record.quantity]
        );
      }
    }

    // 3. Log in inventory history that this was restored
    const historyNotes = `Restored Consumption ID: ${record.id}. Used by: ${record.used_by}`;
    await connection.query(
      `INSERT INTO inventory_history (product_id, change_quantity, action_type, reference_id, reference_number, notes) 
       VALUES (?, ?, 'internal_consumption_restore', ?, ?, ?)`,
      [
        record.product_id,
        record.quantity, // addition
        record.id,
        `CON-${record.id.toString().padStart(5, '0')}`,
        historyNotes.substring(0, 255)
      ]
    );

    // 4. Delete the consumption record
    await connection.query(
      'DELETE FROM internal_consumptions WHERE id = ?',
      [id]
    );

    await connection.commit();
    res.json({ success: true, message: 'Consumption record deleted & stock restored successfully!' });

  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    connection.release();
  }
};
