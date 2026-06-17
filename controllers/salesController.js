const db = require('../config/database');

exports.list = async (req, res) => {
  try {
    const [sales] = await db.query(`
      SELECT s.*, c.name as customer_name, c.mobile as customer_mobile, DATE_FORMAT(s.sale_date, '%Y-%m-%d') as sale_date 
      FROM sales s 
      JOIN customers c ON s.customer_id = c.id 
      ORDER BY s.created_at DESC
    `);
    res.json({ success: true, sales });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.get = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Fetch sale
    const [sales] = await db.query(`
      SELECT s.*, c.name as customer_name, c.mobile as customer_mobile, c.email as customer_email, c.address as customer_address, 
             DATE_FORMAT(s.sale_date, '%Y-%m-%d') as sale_date 
      FROM sales s 
      JOIN customers c ON s.customer_id = c.id 
      WHERE s.id = ? LIMIT 1
    `, [id]);

    if (sales.length === 0) {
      return res.status(404).json({ error: 'Sale record not found' });
    }

    // Fetch sale items
    const [items] = await db.query(`
      SELECT si.*, p.name as product_name, p.code as product_code 
      FROM sale_items si 
      JOIN products p ON si.product_id = p.id 
      WHERE si.sale_id = ?
    `, [id]);

    const sale = sales[0];
    sale.items = items;

    res.json({ success: true, sale });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// POS checkout / save sale
exports.create = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { customer_id, subtotal, discount, tax, shipping, grand_total, items, payment_method } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty. Please add products.' });
    }

    if (!customer_id) {
      return res.status(400).json({ error: 'Customer is required' });
    }

    // Auto-generate invoice number: INV-YYYYMMDD-XXXX
    const [[{ maxId }]] = await connection.query('SELECT COALESCE(MAX(id), 0) as maxId FROM sales');
    const todayStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const invoiceNumber = `INV-${todayStr}-${String(maxId + 1).padStart(4, '0')}`;

    // Record sale
    const [saleResult] = await connection.query(
      `INSERT INTO sales (invoice_number, customer_id, payment_method, subtotal, discount, gst_amount, shipping_charge, grand_total, sale_date) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE())`,
      [
        invoiceNumber,
        customer_id,
        payment_method || 'Cash',
        subtotal || 0,
        discount || 0,
        tax || 0,
        shipping || 0,
        grand_total || 0
      ]
    );

    const saleId = saleResult.insertId;

    // Record sale items, deduct stock, audit rates
    for (const item of items) {
      const productId = parseInt(item.id);
      const sizeVal = item.size || null;
      const qty = parseInt(item.quantity);
      const rate = parseFloat(item.price);
      const total = qty * rate;

      // Insert item
      await connection.query(
        'INSERT INTO sale_items (sale_id, product_id, size, quantity, rate, total) VALUES (?, ?, ?, ?, ?, ?)',
        [saleId, productId, sizeVal, qty, rate, total]
      );

      // Deduct from general product inventory
      await connection.query(
        'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
        [qty, productId]
      );

      // Deduct variant stock if sizing selected
      if (sizeVal) {
        await connection.query(
          'UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE product_id = ? AND LOWER(size) = LOWER(?)',
          [qty, productId, sizeVal]
        );
      }

      // Audit deviation in pricing catalog
      const [products] = await connection.query('SELECT name, code, sales_price FROM products WHERE id = ? LIMIT 1', [productId]);
      if (products.length > 0) {
        const catalogPrice = parseFloat(products[0].sales_price);
        if (Math.abs(rate - catalogPrice) > 0.009) {
          // Log price deviation
          await connection.query(
            `INSERT INTO price_audit_log 
             (admin_id, username, product_id, product_name, product_code, original_price, edited_price, transaction_type, reference_id, reference_number) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'sale', ?, ?)`,
            [
              req.user.id,
              req.user.username,
              productId,
              products[0].name,
              products[0].code,
              catalogPrice,
              rate,
              saleId,
              invoiceNumber
            ]
          );
        }
      }
    }

    await connection.commit();
    res.status(201).json({
      success: true,
      message: 'Sale transaction completed successfully!',
      invoiceId: saleId,
      invoiceNumber
    });

  } catch (error) {
    await connection.rollback();
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

    // Check if sale exists
    const [sales] = await connection.query('SELECT id FROM sales WHERE id = ? LIMIT 1', [id]);
    if (sales.length === 0) {
      return res.status(404).json({ error: 'Sale record not found' });
    }

    // Revert inventory stock
    const [items] = await connection.query('SELECT product_id, size, quantity FROM sale_items WHERE sale_id = ?', [id]);
    for (const item of items) {
      // Revert general stock
      await connection.query(
        'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
        [item.quantity, item.product_id]
      );

      // Revert size variant stock if specified
      if (item.size) {
        await connection.query(
          'UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE product_id = ? AND LOWER(size) = LOWER(?)',
          [item.quantity, item.product_id, item.size]
        );
      }
    }

    // Delete sale (cascades items deletion)
    await connection.query('DELETE FROM sales WHERE id = ?', [id]);

    await connection.commit();
    res.json({ success: true, message: 'Sale deleted successfully and catalog stock reinstated' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    connection.release();
  }
};

// Retrieve price audits list
exports.priceAudits = async (req, res) => {
  try {
    const [audits] = await db.query(`
      SELECT a.*, DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') as created_at 
      FROM price_audit_log a 
      ORDER BY a.created_at DESC
    `);
    res.json({ success: true, audits });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Update sale status (e.g. Generated, Sent)
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatus = ['Generated', 'Sent'];
    if (!status || !validStatus.includes(status)) {
      return res.status(400).json({ error: 'Invalid or missing status' });
    }

    const [result] = await db.query('UPDATE sales SET status = ? WHERE id = ?', [status, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Invoice record not found' });
    }

    res.json({ success: true, message: `Invoice status updated to ${status} successfully!` });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Edit completed POS sale/order
exports.edit = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const { customer_id, subtotal, discount, tax, shipping, grand_total, items, payment_method, reason } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty. Please add products.' });
    }

    if (!customer_id) {
      return res.status(400).json({ error: 'Customer is required' });
    }

    if (!reason) {
      return res.status(400).json({ error: 'Reason for edit is required' });
    }

    // 1. Fetch original sale
    const [sales] = await connection.query('SELECT * FROM sales WHERE id = ? LIMIT 1', [id]);
    if (sales.length === 0) {
      return res.status(404).json({ error: 'Original sale record not found' });
    }
    const originalSale = sales[0];

    if (['Cancelled', 'Revised', 'Superseded'].includes(originalSale.status)) {
      return res.status(400).json({ error: `Cannot edit this invoice because its status is already ${originalSale.status}` });
    }

    // 2. Check lock duration
    const [settings] = await connection.query("SELECT value FROM settings WHERE key_name = 'pos_edit_lock_hours' LIMIT 1");
    const lockHours = settings.length > 0 ? parseFloat(settings[0].value) : 24;
    const originalTime = new Date(originalSale.created_at).getTime();
    const nowTime = Date.now();
    if ((nowTime - originalTime) > lockHours * 60 * 60 * 1000) {
      return res.status(400).json({ error: `Editing is locked for this invoice because it was created more than ${lockHours} hours ago.` });
    }

    // 3. Fetch original sale items for snapshot and stock reversal
    const [originalItems] = await connection.query(`
      SELECT si.*, p.name as product_name, p.code as product_code 
      FROM sale_items si 
      JOIN products p ON si.product_id = p.id 
      WHERE si.sale_id = ?
    `, [id]);
    
    // Save snapshot of before details
    const beforeDetails = JSON.stringify({
      sale: originalSale,
      items: originalItems
    });

    // 4. Reverse original stock movement
    for (const item of originalItems) {
      // Revert general stock
      await connection.query(
        'UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?',
        [item.quantity, item.product_id]
      );
      // Revert size variant stock if specified
      if (item.size) {
        await connection.query(
          'UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE product_id = ? AND LOWER(size) = LOWER(?)',
          [item.quantity, item.product_id, item.size]
        );
      }
    }

    // 5. Generate new invoice number with suffix
    let originalInvoiceNumber = originalSale.invoice_number;
    let newInvoiceNumber = '';
    const revMatch = originalInvoiceNumber.match(/-REV(\d+)$/i);
    if (revMatch) {
      const revNum = parseInt(revMatch[1]) + 1;
      newInvoiceNumber = originalInvoiceNumber.replace(/-REV\d+$/i, `-REV${revNum}`);
    } else {
      newInvoiceNumber = `${originalInvoiceNumber}-REV1`;
    }

    // 6. Update status of original sale to 'Revised'
    await connection.query('UPDATE sales SET status = ? WHERE id = ?', ['Revised', id]);

    // 7. Create new revised sale
    const [newSaleResult] = await connection.query(
      `INSERT INTO sales (invoice_number, order_number, customer_id, payment_method, subtotal, discount, gst_amount, shipping_charge, grand_total, sale_date, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Generated')`,
      [
        newInvoiceNumber,
        originalSale.order_number,
        customer_id,
        payment_method || originalSale.payment_method,
        subtotal || 0,
        discount || 0,
        tax || 0,
        shipping || 0,
        grand_total || 0,
        originalSale.sale_date
      ]
    );
    const newSaleId = newSaleResult.insertId;

    // 8. Insert new items and deduct stock
    const newItems = [];
    for (const item of items) {
      const productId = parseInt(item.id);
      const sizeVal = item.size || null;
      const qty = parseInt(item.quantity);
      const rate = parseFloat(item.price);
      const total = qty * rate;

      // Insert new item
      await connection.query(
        'INSERT INTO sale_items (sale_id, product_id, size, quantity, rate, total) VALUES (?, ?, ?, ?, ?, ?)',
        [newSaleId, productId, sizeVal, qty, rate, total]
      );
      
      newItems.push({ product_id: productId, size: sizeVal, quantity: qty, rate, total, product_name: item.name, product_code: item.code });

      // Deduct from general product inventory
      await connection.query(
        'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
        [qty, productId]
      );

      // Deduct variant stock if sizing selected
      if (sizeVal) {
        await connection.query(
          'UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE product_id = ? AND LOWER(size) = LOWER(?)',
          [qty, productId, sizeVal]
        );
      }

      // Log pricing deviation in catalog
      const [products] = await connection.query('SELECT name, code, sales_price FROM products WHERE id = ? LIMIT 1', [productId]);
      if (products.length > 0) {
        const catalogPrice = parseFloat(products[0].sales_price);
        if (Math.abs(rate - catalogPrice) > 0.009) {
          await connection.query(
            `INSERT INTO price_audit_log 
             (admin_id, username, product_id, product_name, product_code, original_price, edited_price, transaction_type, reference_id, reference_number) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'sale', ?, ?)`,
            [
              req.user.id,
              req.user.username,
              productId,
              products[0].name,
              products[0].code,
              catalogPrice,
              rate,
              newSaleId,
              newInvoiceNumber
            ]
          );
        }
      }
    }

    // 9. Save audit trail
    const afterDetails = JSON.stringify({
      sale: {
        id: newSaleId,
        invoice_number: newInvoiceNumber,
        customer_id,
        payment_method,
        subtotal,
        discount,
        gst_amount: tax,
        shipping_charge: shipping,
        grand_total,
        sale_date: originalSale.sale_date,
        status: 'Generated'
      },
      items: newItems
    });

    await connection.query(
      `INSERT INTO sales_edit_audit 
       (sale_id, invoice_number, original_sale_id, original_invoice_number, edited_by_user_id, edited_by_name, edited_by_role, before_details, after_details, reason) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newSaleId,
        newInvoiceNumber,
        id,
        originalInvoiceNumber,
        req.user.id,
        req.user.username,
        req.user.role,
        beforeDetails,
        afterDetails,
        reason
      ]
    );

    await connection.commit();
    res.status(201).json({
      success: true,
      message: 'Sale transaction edited and revised successfully!',
      invoiceId: newSaleId,
      invoiceNumber: newInvoiceNumber
    });

  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Server error: ' + error.message });
  } finally {
    connection.release();
  }
};

// Retrieve edit audit logs for a specific sale
exports.getAudits = async (req, res) => {
  try {
    const { id } = req.params;
    const [audits] = await db.query(`
      SELECT a.*, DATE_FORMAT(a.edited_at, '%Y-%m-%d %H:%i:%s') as edited_at
      FROM sales_edit_audit a
      WHERE a.original_sale_id = ? OR a.sale_id = ?
      ORDER BY a.edited_at DESC
    `, [id, id]);
    res.json({ success: true, audits });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

