const fs = require('fs');
const path = require('path');
const db = require('../config/database');

exports.list = async (req, res) => {
  try {
    const [purchases] = await db.query(`
      SELECT p.*, s.name as supplier_name, DATE_FORMAT(p.purchase_date, '%Y-%m-%d') as purchase_date 
      FROM purchases p 
      JOIN suppliers s ON p.supplier_id = s.id 
      ORDER BY p.purchase_date DESC
    `);
    res.json({ success: true, purchases });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.get = async (req, res) => {
  try {
    const { id } = req.params;
    const [purchases] = await db.query(`
      SELECT p.*, s.name as supplier_name, s.mobile as supplier_mobile, s.address as supplier_address, 
             DATE_FORMAT(p.purchase_date, '%Y-%m-%d') as purchase_date 
      FROM purchases p 
      JOIN suppliers s ON p.supplier_id = s.id 
      WHERE p.id = ? LIMIT 1
    `, [id]);

    if (purchases.length === 0) {
      return res.status(404).json({ error: 'Purchase transaction not found' });
    }

    const [items] = await db.query(`
      SELECT pi.*, p.name as product_name, p.code as product_code 
      FROM purchase_items pi 
      JOIN products p ON pi.product_id = p.id 
      WHERE pi.purchase_id = ?
    `, [id]);

    const purchase = purchases[0];
    purchase.items = items;

    res.json({ success: true, purchase });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.create = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { supplier_id, purchase_date, note, items } = req.body;
    let parsedItems = items;
    
    if (typeof items === 'string') {
      parsedItems = JSON.parse(items);
    }

    if (!supplier_id || !purchase_date || !parsedItems || !Array.isArray(parsedItems) || parsedItems.length === 0) {
      return res.status(400).json({ error: 'Supplier, date, and purchase items are required' });
    }

    // Auto-generate invoice/reference number
    const [[{ maxId }]] = await connection.query('SELECT COALESCE(MAX(id), 0) as maxId FROM purchases');
    const invoiceNumber = `PUR-${new Date(purchase_date).getFullYear()}${String(new Date(purchase_date).getMonth() + 1).padStart(2, '0')}-${String(maxId + 1).padStart(4, '0')}`;

    // Handle uploaded receipt thumbnail
    const receiptPath = req.file ? `uploads/purchases/${req.file.filename}` : null;

    // Calculate total amount
    let totalAmount = 0;
    parsedItems.forEach(item => {
      totalAmount += parseFloat(item.quantity || 0) * parseFloat(item.price || 0);
    });

    // Insert purchase
    const [purchaseResult] = await connection.query(
      `INSERT INTO purchases (invoice_number, supplier_id, total_amount, purchase_date, note, thumbnail_image) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [invoiceNumber, supplier_id, totalAmount, purchase_date, note || null, receiptPath]
    );

    const purchaseId = purchaseResult.insertId;

    // Insert purchase items and adjust product stock
    for (const item of parsedItems) {
      const productId = parseInt(item.product_id);
      const qty = parseInt(item.quantity);
      const price = parseFloat(item.price);
      const total = qty * price;
      const sizeVal = item.size || null;

      // Insert purchase item
      await connection.query(
        'INSERT INTO purchase_items (purchase_id, product_id, quantity, price, total) VALUES (?, ?, ?, ?, ?)',
        [purchaseId, productId, qty, price, total]
      );

      // Increment general stock of product
      await connection.query('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [qty, productId]);

      // If variant size is selected, update variant stock
      if (sizeVal) {
        // Check if size variant already exists in product_variants
        const [existingVar] = await connection.query(
          'SELECT id, stock_quantity FROM product_variants WHERE product_id = ? AND LOWER(size) = LOWER(?) LIMIT 1',
          [productId, sizeVal]
        );

        if (existingVar.length > 0) {
          await connection.query(
            'UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?',
            [qty, existingVar[0].id]
          );
        } else {
          await connection.query(
            'INSERT INTO product_variants (product_id, size, stock_quantity) VALUES (?, ?, ?)',
            [productId, sizeVal, qty]
          );
        }

        // Keep parent product sizes list updated
        const [allVars] = await connection.query('SELECT size FROM product_variants WHERE product_id = ?', [productId]);
        const sizesArr = allVars.map(v => v.size).sort();
        const sizesStr = sizesArr.join(', ');
        await connection.query('UPDATE products SET size = ? WHERE id = ?', [sizesStr, productId]);
      }

      // Check for price audit deviations (purchase price in transaction differs from product's catalog purchase price)
      const [products] = await connection.query('SELECT name, code, purchase_price FROM products WHERE id = ? LIMIT 1', [productId]);
      if (products.length > 0) {
        const catalogPrice = parseFloat(products[0].purchase_price);
        if (Math.abs(price - catalogPrice) > 0.009) {
          // Log price deviation
          await connection.query(
            `INSERT INTO price_audit_log 
             (admin_id, username, product_id, product_name, product_code, original_price, edited_price, transaction_type, reference_id, reference_number) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'purchase', ?, ?)`,
            [
              req.user.id,
              req.user.username,
              productId,
              products[0].name,
              products[0].code,
              catalogPrice,
              price,
              purchaseId,
              invoiceNumber
            ]
          );
        }
      }
    }

    await connection.commit();
    res.status(201).json({
      success: true,
      message: 'Purchase recorded successfully!',
      purchaseId
    });

  } catch (error) {
    await connection.rollback();
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    connection.release();
  }
};

exports.update = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const { invoice_number, supplier_id, purchase_date, note, items } = req.body;
    let parsedItems = items;
    
    if (typeof items === 'string') {
      parsedItems = JSON.parse(items);
    }

    if (!invoice_number || !supplier_id || !purchase_date || !parsedItems || !Array.isArray(parsedItems) || parsedItems.length === 0) {
      return res.status(400).json({ error: 'Invoice number, Supplier, date, and purchase items are required' });
    }

    // Check if purchase exists
    const [purchases] = await connection.query('SELECT * FROM purchases WHERE id = ? LIMIT 1', [id]);
    if (purchases.length === 0) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    const purchase = purchases[0];

    // A. Fetch current items to deduct original stock
    const [currentItems] = await connection.query('SELECT * FROM purchase_items WHERE purchase_id = ?', [id]);
    for (const origItem of currentItems) {
      await connection.query(
        'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
        [origItem.quantity, origItem.product_id]
      );
    }

    // B. Delete original items from purchase_items
    await connection.query('DELETE FROM purchase_items WHERE purchase_id = ?', [id]);

    // C. Handle receipt bill file upload
    let receiptPath = purchase.thumbnail_image;
    if (req.file) {
      // Unlink old file if exists
      if (receiptPath) {
        const oldPath = path.join(__dirname, '../', receiptPath);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      receiptPath = `uploads/purchases/${req.file.filename}`;
    }

    // D. Insert new purchase items and add to stock
    let totalAmount = 0;
    for (const item of parsedItems) {
      const productId = parseInt(item.product_id || item.id);
      const qty = parseInt(item.quantity);
      const price = parseFloat(item.price);
      const total = qty * price;
      const sizeVal = item.size || null;

      totalAmount += total;

      // Insert purchase item
      await connection.query(
        'INSERT INTO purchase_items (purchase_id, product_id, quantity, price, total) VALUES (?, ?, ?, ?, ?)',
        [id, productId, qty, price, total]
      );

      // Increment general stock of product
      await connection.query('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [qty, productId]);

      // If variant size is selected, update variant stock
      if (sizeVal) {
        const [existingVar] = await connection.query(
          'SELECT id, stock_quantity FROM product_variants WHERE product_id = ? AND LOWER(size) = LOWER(?) LIMIT 1',
          [productId, sizeVal]
        );

        if (existingVar.length > 0) {
          await connection.query(
            'UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?',
            [qty, existingVar[0].id]
          );
        } else {
          await connection.query(
            'INSERT INTO product_variants (product_id, size, stock_quantity) VALUES (?, ?, ?)',
            [productId, sizeVal, qty]
          );
        }

        // Keep parent product sizes list updated
        const [allVars] = await connection.query('SELECT size FROM product_variants WHERE product_id = ?', [productId]);
        const sizesArr = allVars.map(v => v.size).sort();
        const sizesStr = sizesArr.join(', ');
        await connection.query('UPDATE products SET size = ? WHERE id = ?', [sizesStr, productId]);
      }

      // Check for price audit deviations
      const [products] = await connection.query('SELECT name, code, purchase_price FROM products WHERE id = ? LIMIT 1', [productId]);
      if (products.length > 0) {
        const catalogPrice = parseFloat(products[0].purchase_price);
        if (Math.abs(price - catalogPrice) > 0.009) {
          // Log price deviation
          await connection.query(
            `INSERT INTO price_audit_log 
             (admin_id, username, product_id, product_name, product_code, original_price, edited_price, transaction_type, reference_id, reference_number) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'purchase', ?, ?)`,
            [
              req.user.id,
              req.user.username,
              productId,
              products[0].name,
              products[0].code,
              catalogPrice,
              price,
              id,
              invoice_number
            ]
          );
        }
      }
    }

    // E. Update parent purchase record
    await connection.query(
      `UPDATE purchases SET 
       invoice_number = ?, supplier_id = ?, total_amount = ?, purchase_date = ?, note = ?, thumbnail_image = ? 
       WHERE id = ?`,
      [invoice_number, supplier_id, totalAmount, purchase_date, note || null, receiptPath, id]
    );

    await connection.commit();
    res.json({
      success: true,
      message: 'Purchase updated successfully!',
      purchaseId: id
    });

  } catch (error) {
    await connection.rollback();
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    connection.release();
  }
};

exports.delete = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;

    // Check if purchase exists
    const [purchases] = await connection.query('SELECT id, thumbnail_image FROM purchases WHERE id = ? LIMIT 1', [id]);
    if (purchases.length === 0) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    // Deduct stock before deletion
    const [items] = await connection.query('SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?', [id]);
    for (const item of items) {
      await connection.query(
        'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
        [item.quantity, item.product_id]
      );
    }

    // Delete thumbnail file
    const thumbnail = purchases[0].thumbnail_image;
    if (thumbnail) {
      const thumbPath = path.join(__dirname, '../', thumbnail);
      if (fs.existsSync(thumbPath)) {
        fs.unlinkSync(thumbPath);
      }
    }

    // Delete purchase items (cascades automatically due to FOREIGN KEY constraints ON DELETE CASCADE in db)
    await connection.query('DELETE FROM purchases WHERE id = ?', [id]);

    await connection.commit();
    res.json({ success: true, message: 'Purchase deleted successfully and stock reverted' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    connection.release();
  }
};
