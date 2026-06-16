const db = require('../config/database');

// Helper to generate a unique Order Number
const generateOrderNumber = () => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${dateStr}-${rand}`;
};

// 1. Create E-Commerce Order (Public Checkout)
exports.create = async (req, res) => {
  let connection;
  try {
    const {
      customer_name, customer_mobile, customer_email, shipping_address,
      payment_method, items, coupon_code, shipping_charge
    } = req.body;

    if (!customer_name || !customer_mobile || !shipping_address || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Customer name, mobile, address, and product items are required' });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // A. Subtotal calculation
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      if (!item.product_id || !item.quantity || item.quantity <= 0) {
        throw new Error('Valid product_id and quantity are required for all checkout items');
      }

      const [products] = await connection.query('SELECT name, code, sales_price, stock_quantity FROM products WHERE id = ? LIMIT 1', [item.product_id]);
      if (products.length === 0) {
        throw new Error(`Product with ID ${item.product_id} not found`);
      }

      const p = products[0];
      if (p.stock_quantity < item.quantity) {
        throw new Error(`Insufficient stock for product ${p.name}. Only ${p.stock_quantity} left.`);
      }

      const rate = parseFloat(p.sales_price);
      const total = rate * item.quantity;
      subtotal += total;

      validatedItems.push({
        product_id: item.product_id,
        name: p.name,
        code: p.code,
        quantity: item.quantity,
        price: rate,
        total: total,
        old_stock: p.stock_quantity,
        size: item.size || null,
        color: item.color || null
      });
    }

    // B. Handle Coupon discount
    let discount = 0;
    let couponId = null;

    if (coupon_code) {
      const [coupons] = await connection.query('SELECT * FROM coupons WHERE LOWER(code) = LOWER(?) LIMIT 1', [coupon_code]);
      if (coupons.length > 0) {
        const c = coupons[0];
        const today = new Date().toISOString().slice(0, 10);
        
        if (c.status === 'active' && new Date(c.expiry_date) >= new Date(today)) {
          if (c.usage_limit === 0 || c.used_count < c.usage_limit) {
            if (subtotal >= parseFloat(c.min_order_amount)) {
              couponId = c.id;
              if (c.type === 'fixed') {
                discount = parseFloat(c.value);
              } else if (c.type === 'percentage') {
                discount = subtotal * (parseFloat(c.value) / 100);
              }
              // Constrain discount to not exceed subtotal
              if (discount > subtotal) discount = subtotal;
            }
          }
        }
      }
    }

    // Fetch dynamic settings from database
    const [settings] = await connection.query('SELECT key_name, value FROM settings');
    const gstSetting = settings.find(s => s.key_name === 'gst_percentage');
    const shipFixedSetting = settings.find(s => s.key_name === 'shipping_fixed');
    const shipThresholdSetting = settings.find(s => s.key_name === 'shipping_threshold');

    const gstPercent = gstSetting ? parseFloat(gstSetting.value) : 5;
    const shippingFixed = shipFixedSetting ? parseFloat(shipFixedSetting.value) : 100;
    const shippingThreshold = shipThresholdSetting ? parseFloat(shipThresholdSetting.value) : 1500;

    // Dynamic shipping calculations
    let calculatedShipping = subtotal >= shippingThreshold ? 0 : shippingFixed;
    
    // Support premium express shipping client additions if any
    const clientShipping = parseFloat(shipping_charge || 0);
    if (clientShipping > calculatedShipping) {
      calculatedShipping = clientShipping;
    }

    const taxableAmount = Math.max(0, subtotal - discount);
    const gst = parseFloat((taxableAmount * (gstPercent / 100)).toFixed(2));
    const grandTotal = taxableAmount + gst + calculatedShipping;

    const orderNumber = generateOrderNumber();
    const orderDate = new Date().toISOString().slice(0, 10);

    // C. Save Parent Order
    const [orderResult] = await connection.query(`
      INSERT INTO orders 
      (order_number, customer_name, customer_mobile, customer_email, shipping_address, payment_method, subtotal, discount, gst_amount, shipping_charge, grand_total, status, order_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
    `, [
      orderNumber, customer_name, customer_mobile, customer_email || null, shipping_address,
      payment_method || 'COD', subtotal, discount, gst, calculatedShipping, grandTotal, orderDate
    ]);

    const orderId = orderResult.insertId;

    // D. Save Order Items & Reduce Stock & Log Alerts
    for (const vItem of validatedItems) {
      await connection.query(`
        INSERT INTO order_items (order_id, product_id, quantity, price, total, size, color)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [orderId, vItem.product_id, vItem.quantity, vItem.price, vItem.total, vItem.size, vItem.color]);

      // Automated stock reduction
      const newStock = vItem.old_stock - vItem.quantity;
      await connection.query('UPDATE products SET stock_quantity = ? WHERE id = ?', [newStock, vItem.product_id]);

      // Write change tracking log to inventory history
      await connection.query(`
        INSERT INTO inventory_history (product_id, change_quantity, action_type, reference_id, reference_number, notes)
        VALUES (?, ?, 'E-commerce Order', ?, ?, ?)
      `, [
        vItem.product_id,
        -vItem.quantity,
        orderId,
        orderNumber,
        `Stock auto-reduced after e-commerce checkout. Prev stock: ${vItem.old_stock}. New stock: ${newStock}.`
      ]);

      // Automated Low Stock Notification Alert
      if (newStock <= 10) {
        await connection.query(`
          INSERT INTO notifications (type, message, reference_id)
          VALUES ('low_stock', ?, ?)
        `, [
          `Product ${vItem.name} (${vItem.code}) is running low on stock (${newStock} units left).`,
          vItem.product_id
        ]);
      }
    }

    // E. Increment Coupon usage counter
    if (couponId) {
      await connection.query('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [couponId]);
    }

    // F. Create New Order Notification
    await connection.query(`
      INSERT INTO notifications (type, message, reference_id)
      VALUES ('new_order', ?, ?)
    `, [
      `New e-commerce order ${orderNumber} placed by ${customer_name} for ₹${grandTotal.toFixed(2)}.`,
      orderId
    ]);

    // G. Create New Customer Notification if this mobile is new
    const [existingCust] = await connection.query('SELECT id FROM customers WHERE mobile = ? LIMIT 1', [customer_mobile]);
    if (existingCust.length === 0) {
      // Auto-register customer profile inside customers ledger
      await connection.query(`
        INSERT INTO customers (name, mobile, email, address, status, source)
        VALUES (?, ?, ?, ?, 'active', 'Website')
      `, [customer_name, customer_mobile, customer_email || null, shipping_address]);

      await connection.query(`
        INSERT INTO notifications (type, message)
        VALUES ('new_customer', ?)
      `, [`New customer profile created for ${customer_name} (${customer_mobile}).`]);
    }

    await connection.commit();

    // Broadcast WebSocket notification to all active admin/mobile sessions
    const io = req.app.get('io');
    if (io) {
      io.emit('admin_notification', {
        type: 'new_order',
        message: `New e-commerce order ${orderNumber} placed by ${customer_name} for ₹${grandTotal.toFixed(2)}.`,
        reference_id: orderId,
        created_at: new Date()
      });
    }

    res.status(201).json({
      success: true,
      message: 'Order placed successfully!',
      orderId,
      orderNumber,
      grandTotal
    });

  } catch (error) {
    if (connection) await connection.rollback();
    res.status(500).json({ error: error.message || 'Failed to place order.' });
  } finally {
    if (connection) connection.release();
  }
};

// 2. View All Orders (Searchable & Filterable - Admin)
exports.list = async (req, res) => {
  try {
    const { q, status, startDate, endDate } = req.query;

    let sql = `
      SELECT id, order_number, customer_name, customer_mobile, grand_total, status, order_date, created_at 
      FROM orders 
      WHERE 1=1
    `;
    const params = [];

    if (q) {
      sql += ' AND (order_number LIKE ? OR customer_name LIKE ? OR customer_mobile LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    if (startDate && endDate) {
      sql += ' AND order_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }

    sql += ' ORDER BY created_at DESC';

    const [orders] = await db.query(sql, params);
    res.json({ success: true, orders });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 3. Single Order Details (Admin)
exports.get = async (req, res) => {
  try {
    const { id } = req.params;

    const [orders] = await db.query('SELECT * FROM orders WHERE id = ? LIMIT 1', [id]);
    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orders[0];

    // Fetch items with product names
    const [items] = await db.query(`
      SELECT oi.*, p.name as product_name, p.code as product_code, p.image as product_image
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `, [id]);

    order.items = items;
    res.json({ success: true, order });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

const getOrCreateInvoiceForOrder = async (connection, orderId) => {
  // 1. Fetch order details
  const [orders] = await connection.query(`
    SELECT id, status, order_number, customer_name, customer_mobile, customer_email, 
           shipping_address, payment_method, subtotal, discount, gst_amount, 
           shipping_charge, grand_total, invoice_number 
    FROM orders 
    WHERE id = ? LIMIT 1
  `, [orderId]);

  if (orders.length === 0) {
    throw new Error('Order not found');
  }

  const order = orders[0];

  // If invoice already exists, fetch it from sales table and return its ID
  if (order.invoice_number) {
    const [sales] = await connection.query('SELECT id, invoice_number FROM sales WHERE invoice_number = ? LIMIT 1', [order.invoice_number]);
    if (sales.length > 0) {
      return { saleId: sales[0].id, invoiceNumber: sales[0].invoice_number };
    }
  }

  // 2. Get or create customer ID matching order mobile
  const [customers] = await connection.query('SELECT id FROM customers WHERE mobile = ? LIMIT 1', [order.customer_mobile]);
  let customerId;
  if (customers.length > 0) {
    customerId = customers[0].id;
  } else {
    const [insertCust] = await connection.query(`
      INSERT INTO customers (name, mobile, email, address, status, source)
      VALUES (?, ?, ?, ?, 'active', 'Website')
    `, [order.customer_name, order.customer_mobile, order.customer_email || null, order.shipping_address]);
    customerId = insertCust.insertId;
  }

  // 3. Generate unique invoice number: INV-YYYYMMDD-XXXX
  const [[{ maxId }]] = await connection.query('SELECT COALESCE(MAX(id), 0) as maxId FROM sales');
  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const invoiceNumber = `INV-${todayStr}-${String(maxId + 1).padStart(4, '0')}`;

  // 4. Insert into sales table
  const [saleResult] = await connection.query(`
    INSERT INTO sales (invoice_number, order_number, customer_id, payment_method, subtotal, discount, gst_amount, shipping_charge, grand_total, status, sale_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Generated', CURDATE())
  `, [
    invoiceNumber,
    order.order_number,
    customerId,
    order.payment_method || 'COD',
    order.subtotal || 0,
    order.discount || 0,
    order.gst_amount || 0,
    order.shipping_charge || 0,
    order.grand_total || 0
  ]);

  const saleId = saleResult.insertId;

  // 5. Fetch order items and insert into sale_items
  const [orderItems] = await connection.query('SELECT product_id, size, quantity, price, total FROM order_items WHERE order_id = ?', [orderId]);
  for (const item of orderItems) {
    await connection.query(`
      INSERT INTO sale_items (sale_id, product_id, size, quantity, rate, total)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      saleId,
      item.product_id,
      item.size || null,
      item.quantity,
      item.price,
      item.total
    ]);
  }

  // 6. Link invoice number back to the e-commerce order
  await connection.query('UPDATE orders SET invoice_number = ? WHERE id = ?', [invoiceNumber, orderId]);
  console.log(`Automatically generated invoice ${invoiceNumber} for order ${order.order_number}`);

  return { saleId, invoiceNumber };
};

// 4. Update Order Status (Admin)
exports.updateStatus = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatus = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned'];
    if (!status || !validStatus.includes(status)) {
      return res.status(400).json({ error: 'Invalid or missing status' });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // Check order exists
    const [orders] = await connection.query(`
      SELECT status, order_number, customer_name, customer_mobile, customer_email, 
             shipping_address, payment_method, subtotal, discount, gst_amount, 
             shipping_charge, grand_total, invoice_number 
      FROM orders 
      WHERE id = ? LIMIT 1
    `, [id]);
    if (orders.length === 0) {
      throw new Error('Order not found');
    }

    const currentStatus = orders[0].status;
    const orderNumber = orders[0].order_number;

    if (currentStatus === status) {
      await connection.commit();
      return res.json({ success: true, message: `Status is already ${status}` });
    }

    // A. Handle Cancellation or Return Inventory Stock Reversal
    if ((status === 'Cancelled' || status === 'Returned') && (currentStatus !== 'Cancelled' && currentStatus !== 'Returned')) {
      const [items] = await connection.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [id]);
      
      for (const item of items) {
        const [products] = await connection.query('SELECT name, stock_quantity FROM products WHERE id = ? LIMIT 1', [item.product_id]);
        if (products.length > 0) {
          const p = products[0];
          const restoredStock = p.stock_quantity + item.quantity;
          
          await connection.query('UPDATE products SET stock_quantity = ? WHERE id = ?', [restoredStock, item.product_id]);

          // Log inventory history reversal
          await connection.query(`
            INSERT INTO inventory_history (product_id, change_quantity, action_type, reference_id, reference_number, notes)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [
            item.product_id,
            item.quantity,
            status === 'Cancelled' ? 'E-commerce Order Cancel' : 'E-commerce Order Return',
            id,
            orderNumber,
            `Stock auto-restored after order ${status.toLowerCase()}. Prev stock: ${p.stock_quantity}. New stock: ${restoredStock}.`
          ]);
        }
      }
    }

    // B. Handle Stock re-reduction if moving BACK from Cancelled/Returned to active status
    if ((currentStatus === 'Cancelled' || currentStatus === 'Returned') && (status !== 'Cancelled' && status !== 'Returned')) {
      const [items] = await connection.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [id]);
      
      for (const item of items) {
        const [products] = await connection.query('SELECT name, stock_quantity FROM products WHERE id = ? LIMIT 1', [item.product_id]);
        if (products.length > 0) {
          const p = products[0];
          if (p.stock_quantity < item.quantity) {
            throw new Error(`Insufficient stock for product ${p.name} to revert ${currentStatus.toLowerCase()} status. Only ${p.stock_quantity} left.`);
          }

          const reducedStock = p.stock_quantity - item.quantity;
          await connection.query('UPDATE products SET stock_quantity = ? WHERE id = ?', [reducedStock, item.product_id]);

          // Log inventory history reduction
          await connection.query(`
            INSERT INTO inventory_history (product_id, change_quantity, action_type, reference_id, reference_number, notes)
            VALUES (?, ?, 'E-commerce Order', ?, ?, ?)
          `, [
            item.product_id,
            -item.quantity,
            id,
            orderNumber,
            `Stock auto-reduced after order status restored. Prev stock: ${p.stock_quantity}. New stock: ${reducedStock}.`
          ]);
        }
      }
    }

    // C. Update parent Order Status
    await connection.query('UPDATE orders SET status = ? WHERE id = ?', [status, id]);

    // D. Generate Invoice automatically if status changed to 'Delivered'
    if (status === 'Delivered' && currentStatus !== 'Delivered') {
      await getOrCreateInvoiceForOrder(connection, id);
    }

    await connection.commit();
    res.json({ success: true, message: `Order status updated to ${status} successfully!` });

  } catch (error) {
    if (connection) await connection.rollback();
    res.status(500).json({ error: error.message || 'Failed to update status.' });
  } finally {
    if (connection) connection.release();
  }
};

// 5. Get Order by Order Number (Public E-Commerce Tracking)
exports.track = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const [orders] = await db.query('SELECT * FROM orders WHERE order_number = ? LIMIT 1', [orderNumber]);
    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found with the provided order number.' });
    }
    const order = orders[0];
    
    // Fetch items with product names
    const [items] = await db.query(`
      SELECT oi.*, p.name as product_name, p.code as product_code, p.image as product_image
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `, [order.id]);

    order.items = items;
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 6. Get Order Dashboard Summary counts (Admin)
exports.summary = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'Processing' THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN status = 'Returned' THEN 1 ELSE 0 END) AS returned
      FROM orders
    `);

    const summary = {
      total: rows[0].total || 0,
      pending: parseInt(rows[0].pending) || 0,
      processing: parseInt(rows[0].processing) || 0,
      completed: parseInt(rows[0].completed) || 0,
      cancelled: parseInt(rows[0].cancelled) || 0,
      returned: parseInt(rows[0].returned) || 0
    };

    res.json({
      success: true,
      summary
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 7. Get or generate invoice for E-Commerce order
exports.getInvoice = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    connection = await db.getConnection();
    await connection.beginTransaction();

    const result = await getOrCreateInvoiceForOrder(connection, id);

    await connection.commit();
    res.json({ success: true, ...result });
  } catch (error) {
    if (connection) await connection.rollback();
    res.status(500).json({ error: error.message || 'Failed to generate or retrieve invoice.' });
  } finally {
    if (connection) connection.release();
  }
};

// 8. Delete E-Commerce Order
exports.delete = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    connection = await db.getConnection();
    await connection.beginTransaction();

    // Fetch order to verify existence and check status
    const [orders] = await connection.query('SELECT status, invoice_number FROM orders WHERE id = ? LIMIT 1', [id]);
    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orders[0];
    
    // Prevent accidental deletion of completed (Delivered) orders
    if (order.status === 'Delivered') {
      return res.status(400).json({ error: 'Cannot delete a completed (Delivered) order. Please cancel or return it first if needed.' });
    }

    // Delete order items
    await connection.query('DELETE FROM order_items WHERE order_id = ?', [id]);

    // Delete order
    await connection.query('DELETE FROM orders WHERE id = ?', [id]);

    await connection.commit();
    res.json({ success: true, message: 'Order deleted successfully!' });
  } catch (error) {
    if (connection) await connection.rollback();
    res.status(500).json({ error: error.message || 'Failed to delete order.' });
  } finally {
    if (connection) connection.release();
  }
};
