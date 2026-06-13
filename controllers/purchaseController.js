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

    const purchase = purchases[0];

    const [items] = await db.query(`
      SELECT pi.*, pr.name as product_name, pr.sku as product_sku
      FROM purchase_items pi
      JOIN products pr ON pi.product_id = pr.id
      WHERE pi.purchase_id = ?
    `, [id]);

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

    const { supplier_id, purchase_date, note, total_amount, items } = req.body;

    if (!supplier_id || !purchase_date || !total_amount) {
      return res.status(400).json({ error: 'Supplier, date, and total amount are required' });
    }

    // Invoice Ref: check if unique if provided
    let invoiceNumber = req.body.invoice_number ? req.body.invoice_number.trim() : null;
    if (invoiceNumber) {
      const [exists] = await connection.query('SELECT id FROM purchases WHERE LOWER(invoice_number) = LOWER(?) LIMIT 1', [invoiceNumber]);
      if (exists.length > 0) {
        return res.status(400).json({ error: `Invoice Reference '${invoiceNumber}' already exists.` });
      }
    } else {
      // Auto-generate invoice/reference number
      const [[{ maxId }]] = await connection.query('SELECT COALESCE(MAX(id), 0) as maxId FROM purchases');
      invoiceNumber = `PUR-${new Date(purchase_date).getFullYear()}${String(new Date(purchase_date).getMonth() + 1).padStart(2, '0')}-${String(maxId + 1).padStart(4, '0')}`;
    }

    // Handle uploaded receipt thumbnail
    const receiptPath = req.file ? `uploads/purchases/${req.file.filename}` : null;

    // Insert purchase
    const [purchaseResult] = await connection.query(
      `INSERT INTO purchases (invoice_number, supplier_id, total_amount, purchase_date, note, thumbnail_image) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [invoiceNumber, supplier_id, total_amount, purchase_date, note || null, receiptPath]
    );

    const purchaseId = purchaseResult.insertId;

    // Handle items
    let parsedItems = [];
    if (items) {
      if (typeof items === 'string') {
        parsedItems = JSON.parse(items);
      } else if (Array.isArray(items)) {
        parsedItems = items;
      }
    }

    for (const item of parsedItems) {
      const productId = item.product_id;
      const size = item.size ? item.size.trim() : '';
      const qty = parseInt(item.quantity || 0);
      const price = parseFloat(item.price || 0);
      const itemTotal = price * qty;

      // Insert item
      await connection.query(
        `INSERT INTO purchase_items (purchase_id, product_id, quantity, price, total, size) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [purchaseId, productId, qty, price, itemTotal, size || null]
      );

      // Increment variant stock
      if (size !== '') {
        const [variants] = await connection.query(
          'SELECT id, stock_quantity FROM product_variants WHERE product_id = ? AND LOWER(size) = LOWER(?) LIMIT 1',
          [productId, size]
        );

        if (variants.length > 0) {
          const newVarStock = parseInt(variants[0].stock_quantity) + qty;
          await connection.query('UPDATE product_variants SET stock_quantity = ? WHERE id = ?', [newVarStock, variants[0].id]);
        } else {
          await connection.query(
            'INSERT INTO product_variants (product_id, size, stock_quantity) VALUES (?, ?, ?)',
            [productId, size, qty]
          );
        }
      }

      // Sync total stock on products
      const [allVars] = await connection.query('SELECT size, stock_quantity FROM product_variants WHERE product_id = ?', [productId]);
      if (allVars.length > 0) {
        const sizesArr = allVars.map(v => v.size).sort();
        const sizesStr = sizesArr.join(', ');
        const totalStock = allVars.reduce((sum, v) => sum + parseInt(v.stock_quantity), 0);
        await connection.query(
          'UPDATE products SET stock_quantity = ?, sizes = ? WHERE id = ?',
          [totalStock, sizesStr, productId]
        );
      } else {
        await connection.query(
          'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
          [qty, productId]
        );
      }

      // Log in inventory_history
      await connection.query(
        `INSERT INTO inventory_history (product_id, change_quantity, action_type, reference_id, reference_number, notes) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [productId, qty, 'Purchase', purchaseId, invoiceNumber, `Stock increased via Purchase (Invoice: ${invoiceNumber})`]
      );
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
  return res.status(400).json({ error: 'Purchase records are immutable for audit tracking and cannot be modified.' });
};

exports.delete = async (req, res) => {
  return res.status(400).json({ error: 'Purchase records are immutable for audit tracking and cannot be deleted.' });
};

