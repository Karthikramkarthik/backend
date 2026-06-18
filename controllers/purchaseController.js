const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { cleanAuditInfo } = require('../middleware/audit');

exports.list = async (req, res) => {
  try {
    const [purchases] = await db.query(`
      SELECT p.*, s.name as supplier_name, DATE_FORMAT(p.purchase_date, '%Y-%m-%d') as purchase_date 
      FROM purchases p 
      JOIN suppliers s ON p.supplier_id = s.id 
      ORDER BY p.purchase_date DESC
    `);
    res.json({ success: true, purchases: cleanAuditInfo(req, purchases) });
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
      SELECT pi.*, pr.name as product_name, pr.code as product_sku, pr.code as product_code
      FROM purchase_items pi
      JOIN products pr ON pi.product_id = pr.id
      WHERE pi.purchase_id = ?
    `, [id]);

    purchase.items = items;

    res.json({ success: true, purchase: cleanAuditInfo(req, purchase) });
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

    let subtotalVal = req.body.subtotal !== undefined && req.body.subtotal !== null && req.body.subtotal !== 'null' && req.body.subtotal !== '' ? parseFloat(req.body.subtotal) : parseFloat(total_amount);
    let taxTypeVal = req.body.tax_type && req.body.tax_type !== 'null' && req.body.tax_type !== '' ? req.body.tax_type : null;
    let taxRateVal = req.body.tax_rate !== undefined && req.body.tax_rate !== null && req.body.tax_rate !== 'null' && req.body.tax_rate !== '' ? parseFloat(req.body.tax_rate) : null;
    let taxAmountVal = req.body.tax_amount !== undefined && req.body.tax_amount !== null && req.body.tax_amount !== 'null' && req.body.tax_amount !== '' ? parseFloat(req.body.tax_amount) : null;

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
      `INSERT INTO purchases (invoice_number, supplier_id, total_amount, subtotal, tax_type, tax_rate, tax_amount, purchase_date, note, thumbnail_image, created_by_user_id, created_by_name, created_by_role) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceNumber,
        supplier_id,
        total_amount,
        subtotalVal,
        taxTypeVal,
        taxRateVal,
        taxAmountVal,
        purchase_date,
        note || null,
        receiptPath,
        req.user ? req.user.id : null,
        req.user ? req.user.username : null,
        req.user ? req.user.role : null
      ]
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
          'UPDATE products SET stock_quantity = ?, size = ? WHERE id = ?',
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
  const { id } = req.params;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [existingPurchases] = await connection.query('SELECT * FROM purchases WHERE id = ? LIMIT 1', [id]);
    if (existingPurchases.length === 0) {
      return res.status(404).json({ error: 'Purchase transaction not found' });
    }
    const existingPurchase = existingPurchases[0];

    const [existingItems] = await connection.query('SELECT * FROM purchase_items WHERE purchase_id = ?', [id]);

    const { supplier_id, purchase_date, note, total_amount, items } = req.body;

    if (!supplier_id || !purchase_date || !total_amount) {
      return res.status(400).json({ error: 'Supplier, date, and total amount are required' });
    }

    let subtotalVal = req.body.subtotal !== undefined && req.body.subtotal !== null && req.body.subtotal !== 'null' && req.body.subtotal !== '' ? parseFloat(req.body.subtotal) : parseFloat(total_amount);
    let taxTypeVal = req.body.tax_type && req.body.tax_type !== 'null' && req.body.tax_type !== '' ? req.body.tax_type : null;
    let taxRateVal = req.body.tax_rate !== undefined && req.body.tax_rate !== null && req.body.tax_rate !== 'null' && req.body.tax_rate !== '' ? parseFloat(req.body.tax_rate) : null;
    let taxAmountVal = req.body.tax_amount !== undefined && req.body.tax_amount !== null && req.body.tax_amount !== 'null' && req.body.tax_amount !== '' ? parseFloat(req.body.tax_amount) : null;

    let invoiceNumber = req.body.invoice_number ? req.body.invoice_number.trim() : null;
    if (invoiceNumber) {
      if (invoiceNumber.toLowerCase() !== (existingPurchase.invoice_number || '').toLowerCase()) {
        const [exists] = await connection.query('SELECT id FROM purchases WHERE LOWER(invoice_number) = LOWER(?) AND id != ? LIMIT 1', [invoiceNumber, id]);
        if (exists.length > 0) {
          return res.status(400).json({ error: `Invoice Reference '${invoiceNumber}' already exists.` });
        }
      }
    } else {
      invoiceNumber = existingPurchase.invoice_number;
    }

    let parsedItems = [];
    if (items) {
      if (typeof items === 'string') {
        parsedItems = JSON.parse(items);
      } else if (Array.isArray(items)) {
        parsedItems = items;
      }
    }

    // Recalculate stock differences and validate negative stock
    const changes = {}; // key: "product_id:size" => delta quantity
    const productIds = new Set();

    // Subtract existing quantities
    for (const item of existingItems) {
      const sizeKey = item.size ? item.size.trim() : '';
      const key = `${item.product_id}:${sizeKey}`;
      changes[key] = (changes[key] || 0) - parseInt(item.quantity || 0);
      productIds.add(item.product_id);
    }

    // Add new quantities
    for (const item of parsedItems) {
      const sizeKey = item.size ? item.size.trim() : '';
      const key = `${item.product_id}:${sizeKey}`;
      changes[key] = (changes[key] || 0) + parseInt(item.quantity || 0);
      productIds.add(item.product_id);
    }

    const productDeltas = {};

    for (const key of Object.keys(changes)) {
      const [productIdStr, size] = key.split(':');
      const productId = parseInt(productIdStr);
      const delta = changes[key];

      productDeltas[productId] = (productDeltas[productId] || 0) + delta;

      if (size !== '') {
        const [variants] = await connection.query(
          'SELECT id, stock_quantity FROM product_variants WHERE product_id = ? AND LOWER(size) = LOWER(?) LIMIT 1',
          [productId, size]
        );
        const currentVarStock = variants.length > 0 ? parseInt(variants[0].stock_quantity) : 0;
        const newVarStock = currentVarStock + delta;
        if (newVarStock < 0) {
          const [prod] = await connection.query('SELECT name FROM products WHERE id = ? LIMIT 1', [productId]);
          const prodName = prod.length > 0 ? prod[0].name : `Product ID ${productId}`;
          return res.status(400).json({
            error: `Cannot update purchase. Size '${size}' of product '${prodName}' stock would become negative (${newVarStock}).`
          });
        }
      }
    }

    for (const productId of productIds) {
      const delta = productDeltas[productId] || 0;
      const [products] = await connection.query('SELECT id, name, stock_quantity FROM products WHERE id = ? LIMIT 1', [productId]);
      if (products.length === 0) {
        return res.status(404).json({ error: `Product ID ${productId} not found.` });
      }
      const currentProdStock = parseInt(products[0].stock_quantity);
      const newProdStock = currentProdStock + delta;
      if (newProdStock < 0) {
        return res.status(400).json({
          error: `Cannot update purchase. Product '${products[0].name}' total stock would become negative (${newProdStock}).`
        });
      }
    }

    // Log to Audit trail
    const previousValues = JSON.stringify({
      purchase: {
        invoice_number: existingPurchase.invoice_number,
        supplier_id: existingPurchase.supplier_id,
        total_amount: existingPurchase.total_amount,
        subtotal: existingPurchase.subtotal,
        tax_type: existingPurchase.tax_type,
        tax_rate: existingPurchase.tax_rate,
        tax_amount: existingPurchase.tax_amount,
        purchase_date: existingPurchase.purchase_date,
        note: existingPurchase.note,
        thumbnail_image: existingPurchase.thumbnail_image
      },
      items: existingItems.map(item => ({
        product_id: item.product_id,
        size: item.size,
        quantity: item.quantity,
        price: item.price,
        total: item.total
      }))
    });

    await connection.query(
      `INSERT INTO purchase_audit_logs (purchase_id, invoice_number, action, performed_by_user_id, performed_by_name, performed_by_role, previous_values)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        existingPurchase.invoice_number,
        'Edit',
        req.user ? req.user.id : null,
        req.user ? req.user.username : null,
        req.user ? req.user.role : null,
        previousValues
      ]
    );

    // Handle receipt thumbnail upload
    let receiptPath = existingPurchase.thumbnail_image;
    if (req.file) {
      receiptPath = `uploads/purchases/${req.file.filename}`;
      if (existingPurchase.thumbnail_image) {
        const oldPath = path.join(__dirname, '..', existingPurchase.thumbnail_image);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
    }

    // Update purchases table
    await connection.query(
      `UPDATE purchases 
       SET invoice_number = ?, supplier_id = ?, total_amount = ?, subtotal = ?, tax_type = ?, tax_rate = ?, tax_amount = ?, purchase_date = ?, note = ?, thumbnail_image = ?
       WHERE id = ?`,
      [
        invoiceNumber,
        supplier_id,
        total_amount,
        subtotalVal,
        taxTypeVal,
        taxRateVal,
        taxAmountVal,
        purchase_date,
        note || null,
        receiptPath,
        id
      ]
    );

    // Revert old item stocks
    for (const item of existingItems) {
      const productId = item.product_id;
      const size = item.size ? item.size.trim() : '';
      const qty = parseInt(item.quantity || 0);

      if (size !== '') {
        const [variants] = await connection.query(
          'SELECT id, stock_quantity FROM product_variants WHERE product_id = ? AND LOWER(size) = LOWER(?) LIMIT 1',
          [productId, size]
        );
        if (variants.length > 0) {
          const newVarStock = parseInt(variants[0].stock_quantity) - qty;
          await connection.query('UPDATE product_variants SET stock_quantity = ? WHERE id = ?', [newVarStock, variants[0].id]);
        }
      }
    }

    // Delete existing purchase items
    await connection.query('DELETE FROM purchase_items WHERE purchase_id = ?', [id]);

    // Insert new purchase items and add stocks
    for (const item of parsedItems) {
      const productId = item.product_id;
      const size = item.size ? item.size.trim() : '';
      const qty = parseInt(item.quantity || 0);
      const price = parseFloat(item.price || 0);
      const itemTotal = price * qty;

      await connection.query(
        `INSERT INTO purchase_items (purchase_id, product_id, quantity, price, total, size) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, productId, qty, price, itemTotal, size || null]
      );

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
    }

    // Sync total stock on products
    for (const productId of productIds) {
      const [allVars] = await connection.query('SELECT size, stock_quantity FROM product_variants WHERE product_id = ?', [productId]);
      if (allVars.length > 0) {
        const sizesArr = allVars.map(v => v.size).sort();
        const sizesStr = sizesArr.join(', ');
        const totalStock = allVars.reduce((sum, v) => sum + parseInt(v.stock_quantity), 0);
        await connection.query(
          'UPDATE products SET stock_quantity = ?, size = ? WHERE id = ?',
          [totalStock, sizesStr, productId]
        );
      }
    }

    // Log inventory_history
    for (const productId of productIds) {
      const delta = productDeltas[productId] || 0;
      if (delta !== 0) {
        await connection.query(
          `INSERT INTO inventory_history (product_id, change_quantity, action_type, reference_id, reference_number, notes) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            productId,
            delta,
            'Purchase Edit',
            id,
            invoiceNumber,
            `Stock updated via Purchase Edit (Invoice: ${invoiceNumber}, difference: ${delta > 0 ? '+' : ''}${delta})`
          ]
        );
      }
    }

    await connection.commit();
    res.json({ success: true, message: 'Purchase record updated successfully!' });

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
  const { id } = req.params;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [existingPurchases] = await connection.query('SELECT * FROM purchases WHERE id = ? LIMIT 1', [id]);
    if (existingPurchases.length === 0) {
      return res.status(404).json({ error: 'Purchase transaction not found' });
    }
    const existingPurchase = existingPurchases[0];

    const [existingItems] = await connection.query('SELECT * FROM purchase_items WHERE purchase_id = ?', [id]);

    const productIds = new Set();
    const productDeltas = {};

    // Validate negative stock before deletion
    for (const item of existingItems) {
      const productId = item.product_id;
      const size = item.size ? item.size.trim() : '';
      const qty = parseInt(item.quantity || 0);

      productIds.add(productId);
      productDeltas[productId] = (productDeltas[productId] || 0) - qty;

      if (size !== '') {
        const [variants] = await connection.query(
          'SELECT id, stock_quantity FROM product_variants WHERE product_id = ? AND LOWER(size) = LOWER(?) LIMIT 1',
          [productId, size]
        );
        const currentVarStock = variants.length > 0 ? parseInt(variants[0].stock_quantity) : 0;
        const newVarStock = currentVarStock - qty;
        if (newVarStock < 0) {
          const [prod] = await connection.query('SELECT name FROM products WHERE id = ? LIMIT 1', [productId]);
          const prodName = prod.length > 0 ? prod[0].name : `Product ID ${productId}`;
          return res.status(400).json({
            error: `Cannot delete purchase. Size '${size}' of product '${prodName}' stock would become negative (${newVarStock}).`
          });
        }
      }
    }

    for (const productId of productIds) {
      const delta = productDeltas[productId] || 0;
      const [products] = await connection.query('SELECT id, name, stock_quantity FROM products WHERE id = ? LIMIT 1', [productId]);
      if (products.length > 0) {
        const currentProdStock = parseInt(products[0].stock_quantity);
        const newProdStock = currentProdStock + delta;
        if (newProdStock < 0) {
          return res.status(400).json({
            error: `Cannot delete purchase. Product '${products[0].name}' total stock would become negative (${newProdStock}).`
          });
        }
      }
    }

    // Log to audit log
    const previousValues = JSON.stringify({
      purchase: {
        invoice_number: existingPurchase.invoice_number,
        supplier_id: existingPurchase.supplier_id,
        total_amount: existingPurchase.total_amount,
        subtotal: existingPurchase.subtotal,
        tax_type: existingPurchase.tax_type,
        tax_rate: existingPurchase.tax_rate,
        tax_amount: existingPurchase.tax_amount,
        purchase_date: existingPurchase.purchase_date,
        note: existingPurchase.note,
        thumbnail_image: existingPurchase.thumbnail_image
      },
      items: existingItems.map(item => ({
        product_id: item.product_id,
        size: item.size,
        quantity: item.quantity,
        price: item.price,
        total: item.total
      }))
    });

    await connection.query(
      `INSERT INTO purchase_audit_logs (purchase_id, invoice_number, action, performed_by_user_id, performed_by_name, performed_by_role, previous_values)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        existingPurchase.invoice_number,
        'Delete',
        req.user ? req.user.id : null,
        req.user ? req.user.username : null,
        req.user ? req.user.role : null,
        previousValues
      ]
    );

    // Decrement variant stock
    for (const item of existingItems) {
      const productId = item.product_id;
      const size = item.size ? item.size.trim() : '';
      const qty = parseInt(item.quantity || 0);

      if (size !== '') {
        const [variants] = await connection.query(
          'SELECT id, stock_quantity FROM product_variants WHERE product_id = ? AND LOWER(size) = LOWER(?) LIMIT 1',
          [productId, size]
        );
        if (variants.length > 0) {
          const newVarStock = parseInt(variants[0].stock_quantity) - qty;
          await connection.query('UPDATE product_variants SET stock_quantity = ? WHERE id = ?', [newVarStock, variants[0].id]);
        }
      }
    }

    // Sync products total stock
    for (const productId of productIds) {
      const [allVars] = await connection.query('SELECT size, stock_quantity FROM product_variants WHERE product_id = ?', [productId]);
      if (allVars.length > 0) {
        const sizesArr = allVars.map(v => v.size).sort();
        const sizesStr = sizesArr.join(', ');
        const totalStock = allVars.reduce((sum, v) => sum + parseInt(v.stock_quantity), 0);
        await connection.query(
          'UPDATE products SET stock_quantity = ?, size = ? WHERE id = ?',
          [totalStock, sizesStr, productId]
        );
      }
    }

    // Log to inventory_history
    for (const productId of productIds) {
      const delta = productDeltas[productId] || 0;
      await connection.query(
        `INSERT INTO inventory_history (product_id, change_quantity, action_type, reference_id, reference_number, notes) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          productId,
          delta,
          'Purchase Delete',
          id,
          existingPurchase.invoice_number,
          `Stock decreased via Purchase Delete (Invoice: ${existingPurchase.invoice_number})`
        ]
      );
    }

    // Delete purchase items and purchase record
    await connection.query('DELETE FROM purchase_items WHERE purchase_id = ?', [id]);
    await connection.query('DELETE FROM purchases WHERE id = ?', [id]);

    // Clean up receipt file if exists
    if (existingPurchase.thumbnail_image) {
      const oldPath = path.join(__dirname, '..', existingPurchase.thumbnail_image);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    await connection.commit();
    res.json({ success: true, message: 'Purchase record deleted successfully!' });

  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    connection.release();
  }
};

