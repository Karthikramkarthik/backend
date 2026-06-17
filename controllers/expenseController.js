const db = require('../config/database');
const { cleanAuditInfo } = require('../middleware/audit');

exports.list = async (req, res) => {
  try {
    const [expenses] = await db.query("SELECT *, DATE_FORMAT(expense_date, '%Y-%m-%d') as expense_date FROM expenses ORDER BY expense_date DESC");
    res.json({ success: true, expenses: cleanAuditInfo(req, expenses) });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.get = async (req, res) => {
  try {
    const { id } = req.params;
    const [expenses] = await db.query("SELECT *, DATE_FORMAT(expense_date, '%Y-%m-%d') as expense_date FROM expenses WHERE id = ? LIMIT 1", [id]);
    if (expenses.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    res.json({ success: true, expense: cleanAuditInfo(req, expenses[0]) });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { title, amount, expense_date, category, note } = req.body;
    if (!title || !amount || !expense_date) {
      return res.status(400).json({ error: 'Expense title, amount, and date are required' });
    }

    const [result] = await db.query(
      'INSERT INTO expenses (title, amount, expense_date, category, note, created_by_user_id, created_by_name, created_by_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        title,
        amount,
        expense_date,
        category || null,
        note || null,
        req.user ? req.user.id : null,
        req.user ? req.user.username : null,
        req.user ? req.user.role : null
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Expense added successfully',
      expenseId: result.insertId
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, amount, expense_date, category, note } = req.body;

    if (!title || !amount || !expense_date) {
      return res.status(400).json({ error: 'Expense title, amount, and date are required' });
    }

    const [exists] = await db.query('SELECT id FROM expenses WHERE id = ?', [id]);
    if (exists.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    await db.query(
      'UPDATE expenses SET title = ?, amount = ?, expense_date = ?, category = ?, note = ? WHERE id = ?',
      [title, amount, expense_date, category || null, note || null, id]
    );

    res.json({ success: true, message: 'Expense updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM expenses WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json({ success: true, message: 'Expense deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
