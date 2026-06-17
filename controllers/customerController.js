const db = require('../config/database');
const { cleanAuditInfo } = require('../middleware/audit');

exports.list = async (req, res) => {
  try {
    const { source, q } = req.query;
    let query = 'SELECT * FROM customers WHERE 1=1';
    let params = [];

    if (source) {
      query += ' AND source = ?';
      params.push(source);
    }
    if (q) {
      query += ' AND (name LIKE ? OR mobile LIKE ? OR email LIKE ? OR address LIKE ?)';
      const searchLike = `%${q}%`;
      params.push(searchLike, searchLike, searchLike, searchLike);
    }

    query += ' ORDER BY name ASC';
    const [customers] = await db.query(query, params);
    res.json({ success: true, customers: cleanAuditInfo(req, customers) });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.get = async (req, res) => {
  try {
    const { id } = req.params;
    const [customers] = await db.query('SELECT * FROM customers WHERE id = ? LIMIT 1', [id]);
    if (customers.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json({ success: true, customer: cleanAuditInfo(req, customers[0]) });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, mobile, email, address, status, source } = req.body;
    if (!name || !mobile) {
      return res.status(400).json({ error: 'Customer name and mobile number are required' });
    }

    const [result] = await db.query(
      'INSERT INTO customers (name, mobile, email, address, status, source, created_by_user_id, created_by_name, created_by_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        name,
        mobile,
        email || null,
        address || null,
        status || 'active',
        source || 'Admin Panel',
        req.user ? req.user.id : null,
        req.user ? req.user.username : null,
        req.user ? req.user.role : null
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      customerId: result.insertId
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, mobile, email, address, status, source } = req.body;

    if (!name || !mobile) {
      return res.status(400).json({ error: 'Customer name and mobile number are required' });
    }

    const [exists] = await db.query('SELECT id FROM customers WHERE id = ?', [id]);
    if (exists.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    await db.query(
      'UPDATE customers SET name = ?, mobile = ?, email = ?, address = ?, status = ?, source = ? WHERE id = ?',
      [name, mobile, email || null, address || null, status || 'active', source || 'Admin Panel', id]
    );

    res.json({ success: true, message: 'Customer updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if customer is linked to any sales/invoices
    const [sales] = await db.query('SELECT id FROM sales WHERE customer_id = ? LIMIT 1', [id]);
    if (sales.length > 0) {
      return res.status(400).json({
        error: 'Cannot delete customer. They are linked to active sales transaction invoices. You can set customer status to inactive instead.'
      });
    }

    const [result] = await db.query('DELETE FROM customers WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
