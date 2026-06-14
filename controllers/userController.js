const bcrypt = require('bcryptjs');
const db = require('../config/database');

// List all admin users (without password hashes)
exports.getUsers = async (req, res) => {
  try {
    const [users] = await db.query(`
      SELECT a.id, a.username, a.email, a.role_id, a.created_at, r.name as role_name 
      FROM admins a 
      LEFT JOIN roles r ON a.role_id = r.id 
      ORDER BY a.id ASC
    `);
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Create a new admin user
exports.createUser = async (req, res) => {
  try {
    const { username, password, email, role_id } = req.body;

    if (!username || !password || !email || !role_id) {
      return res.status(400).json({ error: 'Please enter all required fields' });
    }

    // Check username / email uniqueness
    const [existing] = await db.query(
      'SELECT id FROM admins WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user
    await db.query(
      'INSERT INTO admins (username, password, email, role_id) VALUES (?, ?, ?, ?)',
      [username, passwordHash, email, role_id]
    );

    res.status(201).json({ success: true, message: 'Admin user created successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Update existing admin user details
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role_id, password } = req.body;

    if (!username || !email || !role_id) {
      return res.status(400).json({ error: 'Please enter all required fields' });
    }

    // Check if user exists
    const [users] = await db.query('SELECT * FROM admins WHERE id = ? LIMIT 1', [id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = users[0];

    // Check duplicates
    const [duplicate] = await db.query(
      'SELECT id FROM admins WHERE (username = ? OR email = ?) AND id != ?',
      [username, email, id]
    );
    if (duplicate.length > 0) {
      return res.status(400).json({ error: 'Username or email is already taken' });
    }

    let query = 'UPDATE admins SET username = ?, email = ?, role_id = ?';
    let params = [username, email, role_id];

    // Optional password update
    if (password && password.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      query += ', password = ?';
      params.push(passwordHash);
    }

    query += ' WHERE id = ?';
    params.push(id);

    await db.query(query, params);

    res.json({ success: true, message: 'User updated successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Delete an admin user (prevent deleting own account)
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Security constraint: You cannot delete your own account' });
    }

    const [users] = await db.query('SELECT * FROM admins WHERE id = ? LIMIT 1', [id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await db.query('DELETE FROM admins WHERE id = ?', [id]);

    res.json({ success: true, message: 'User deleted successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
