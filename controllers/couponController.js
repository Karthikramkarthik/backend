const db = require('../config/database');

// 1. List all coupons (Admin CRUD)
exports.list = async (req, res) => {
  try {
    const [coupons] = await db.query('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json({ success: true, coupons });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 2. Get single coupon (Admin)
exports.get = async (req, res) => {
  try {
    const { id } = req.params;
    const [coupons] = await db.query('SELECT * FROM coupons WHERE id = ? LIMIT 1', [id]);
    if (coupons.length === 0) {
      return res.status(404).json({ error: 'Coupon not found' });
    }
    res.json({ success: true, coupon: coupons[0] });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 3. Create Coupon (Admin)
exports.create = async (req, res) => {
  try {
    const { code, type, value, min_order_amount, expiry_date, usage_limit, status } = req.body;

    if (!code || !type || !value || !expiry_date) {
      return res.status(400).json({ error: 'Coupon code, type, value, and expiry date are required' });
    }

    const validTypes = ['fixed', 'percentage'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Type must be either fixed or percentage' });
    }

    // Check if code already exists
    const [existing] = await db.query('SELECT id FROM coupons WHERE LOWER(code) = LOWER(?) LIMIT 1', [code]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'A coupon with this code already exists' });
    }

    const [result] = await db.query(
      'INSERT INTO coupons (code, type, value, min_order_amount, expiry_date, usage_limit, used_count, status) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
      [code.toUpperCase(), type, value, min_order_amount || 0, expiry_date, usage_limit || 0, status || 'active']
    );

    res.status(201).json({
      success: true,
      message: 'Coupon created successfully',
      couponId: result.insertId
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 4. Edit Coupon (Admin)
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { code, type, value, min_order_amount, expiry_date, usage_limit, status } = req.body;

    if (!code || !type || !value || !expiry_date) {
      return res.status(400).json({ error: 'Coupon code, type, value, and expiry date are required' });
    }

    const validTypes = ['fixed', 'percentage'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Type must be either fixed or percentage' });
    }

    const [existing] = await db.query('SELECT id FROM coupons WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    // Check if new code conflicts with another coupon
    const [codeConflict] = await db.query('SELECT id FROM coupons WHERE LOWER(code) = LOWER(?) AND id != ? LIMIT 1', [code, id]);
    if (codeConflict.length > 0) {
      return res.status(400).json({ error: 'Another coupon with this code already exists' });
    }

    await db.query(
      'UPDATE coupons SET code = ?, type = ?, value = ?, min_order_amount = ?, expiry_date = ?, usage_limit = ?, status = ? WHERE id = ?',
      [code.toUpperCase(), type, value, min_order_amount || 0, expiry_date, usage_limit || 0, status || 'active', id]
    );

    res.json({ success: true, message: 'Coupon updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 5. Delete Coupon (Admin)
exports.delete = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query('DELETE FROM coupons WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    res.json({ success: true, message: 'Coupon deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 6. Public Validate Coupon
exports.validate = async (req, res) => {
  try {
    const code = req.body.code || req.body.coupon_code;
    const amount = req.body.amount || req.body.subtotal;

    if (!code) {
      return res.status(400).json({ error: 'Coupon code is required' });
    }

    const orderAmount = parseFloat(amount || 0);

    const [coupons] = await db.query('SELECT * FROM coupons WHERE LOWER(code) = LOWER(?) LIMIT 1', [code]);

    if (coupons.length === 0) {
      return res.status(404).json({ error: 'Invalid coupon code' });
    }

    const c = coupons[0];
    const today = new Date().toISOString().slice(0, 10);

    if (c.status !== 'active') {
      return res.status(400).json({ error: 'Coupon is inactive' });
    }

    if (new Date(c.expiry_date) < new Date(today)) {
      return res.status(400).json({ error: 'Coupon has expired' });
    }

    if (c.usage_limit > 0 && c.used_count >= c.usage_limit) {
      return res.status(400).json({ error: 'Coupon usage limit reached' });
    }

    if (orderAmount < parseFloat(c.min_order_amount)) {
      return res.status(400).json({ 
        error: `Minimum order amount of ₹${parseFloat(c.min_order_amount).toFixed(2)} required for this coupon` 
      });
    }

    // Calculate discount
    let discount = 0;
    if (c.type === 'fixed') {
      discount = parseFloat(c.value);
    } else if (c.type === 'percentage') {
      discount = orderAmount * (parseFloat(c.value) / 100);
    }

    if (discount > orderAmount) {
      discount = orderAmount;
    }

    res.json({
      success: true,
      message: 'Coupon is valid!',
      coupon: {
        id: c.id,
        code: c.code,
        type: c.type,
        value: parseFloat(c.value),
        discount: parseFloat(discount.toFixed(2))
      }
    });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
