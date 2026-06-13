const db = require('../config/database');

exports.list = async (req, res) => {
  try {
    const [suppliers] = await db.query('SELECT * FROM suppliers ORDER BY name ASC');
    res.json({ success: true, suppliers });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.get = async (req, res) => {
  try {
    const { id } = req.params;
    const [suppliers] = await db.query('SELECT * FROM suppliers WHERE id = ? LIMIT 1', [id]);
    if (suppliers.length === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    res.json({ success: true, supplier: suppliers[0] });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, mobile, gst_number, address } = req.body;
    if (!name || !mobile) {
      return res.status(400).json({ error: 'Supplier name and mobile number are required' });
    }

    const [result] = await db.query(
      'INSERT INTO suppliers (name, mobile, gst_number, address) VALUES (?, ?, ?, ?)',
      [name, mobile, gst_number || null, address || null]
    );

    res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      supplierId: result.insertId
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, mobile, gst_number, address } = req.body;

    if (!name || !mobile) {
      return res.status(400).json({ error: 'Supplier name and mobile number are required' });
    }

    const [exists] = await db.query('SELECT id FROM suppliers WHERE id = ?', [id]);
    if (exists.length === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    await db.query(
      'UPDATE suppliers SET name = ?, mobile = ?, gst_number = ?, address = ? WHERE id = ?',
      [name, mobile, gst_number || null, address || null, id]
    );

    res.json({ success: true, message: 'Supplier updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if supplier is linked to any products
    const [products] = await db.query('SELECT id FROM products WHERE supplier_id = ? LIMIT 1', [id]);
    if (products.length > 0) {
      return res.status(400).json({
        error: 'Cannot delete supplier. It has active product listings in stock. Please reassign those products first.'
      });
    }

    // Check if supplier is linked to any purchases
    const [purchases] = await db.query('SELECT id FROM purchases WHERE supplier_id = ? LIMIT 1', [id]);
    if (purchases.length > 0) {
      return res.status(400).json({
        error: 'Cannot delete supplier. It is linked to active purchase transactions. You can update supplier info instead.'
      });
    }

    const [result] = await db.query('DELETE FROM suppliers WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    res.json({ success: true, message: 'Supplier deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.getPurchases = async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const [suppliers] = await db.query('SELECT * FROM suppliers WHERE id = ? LIMIT 1', [id]);
    if (suppliers.length === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    let query = `
      SELECT p.*, DATE_FORMAT(p.purchase_date, '%Y-%m-%d') as purchase_date
      FROM purchases p
      WHERE p.supplier_id = ?
    `;
    const params = [id];

    if (startDate) {
      query += ' AND p.purchase_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND p.purchase_date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY p.purchase_date DESC, p.id DESC';

    const [purchases] = await db.query(query, params);
    const totalAmount = purchases.reduce((sum, p) => sum + parseFloat(p.total_amount || 0), 0);

    res.json({
      success: true,
      supplier: suppliers[0],
      purchases,
      totalAmount
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

