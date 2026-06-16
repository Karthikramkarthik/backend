const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '../debug.log');
function logDebug(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  console.log(msg);
}

exports.register = async (req, res) => {
  try {
    const { username, password, email, role_id } = req.body;

    if (!username || !password || !email) {
      return res.status(400).json({ error: 'Please enter all required fields' });
    }

    // Check if user already exists
    const [existing] = await db.query(
      'SELECT id FROM admins WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Hash password (compatible with php bcrypt)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user (defaults to role_id = 7 [Viewer] if not specified)
    const assignedRoleId = role_id || 7;
    await db.query(
      'INSERT INTO admins (username, password, email, role_id) VALUES (?, ?, ?, ?)',
      [username, passwordHash, email, assignedRoleId]
    );

    res.status(201).json({ success: true, message: 'User registered successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Please enter all fields' });
    }

    const [users] = await db.query(
      'SELECT a.*, r.name as role_name FROM admins a LEFT JOIN roles r ON a.role_id = r.id WHERE a.username = ? LIMIT 1',
      [username]
    );

    if (users.length === 0) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const user = users[0];
    
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    // Generate Token with Role Claims
    const payload = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role_name || null,
      roleId: user.role_id || null
    };
    
    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET || 'stock_management_jwt_secret_key_2026',
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role_name || null,
        roleId: user.role_id || null
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const adminId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Please fill in all fields' });
    }

    const [users] = await db.query('SELECT password FROM admins WHERE id = ? LIMIT 1', [adminId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await db.query('UPDATE admins SET password = ? WHERE id = ?', [newHash, adminId]);

    res.json({ success: true, message: 'Password updated successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT a.id, a.username, a.email, a.role_id, r.name as role_name FROM admins a LEFT JOIN roles r ON a.role_id = r.id WHERE a.id = ? LIMIT 1',
      [req.user.id]
    );
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const dbUser = users[0];
    res.json({
      success: true,
      user: {
        id: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        role: dbUser.role_name || null,
        roleId: dbUser.role_id || null
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Customer Register
exports.customerRegister = async (req, res) => {
  try {
    const { name, mobile, email, password, address } = req.body;

    if (!name || !mobile || !password) {
      return res.status(400).json({ error: 'Name, mobile, and password are required' });
    }

    // Check if customer already exists by mobile
    const [existing] = await db.query(
      'SELECT id FROM customers WHERE mobile = ?',
      [mobile]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Customer with this mobile number already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert customer
    await db.query(
      'INSERT INTO customers (name, mobile, email, password, address, status, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, mobile, email || null, passwordHash, address || null, 'active', 'Website']
    );

    res.status(201).json({ success: true, message: 'Customer registered successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Customer Login
exports.customerLogin = async (req, res) => {
  try {
    const { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({ error: 'Please enter mobile number and password' });
    }

    const [customers] = await db.query('SELECT * FROM customers WHERE mobile = ? AND status = ? LIMIT 1', [mobile, 'active']);

    if (customers.length === 0) {
      return res.status(400).json({ error: 'Invalid mobile number or password' });
    }

    const customer = customers[0];
    
    // Check password
    if (!customer.password) {
      return res.status(400).json({ error: 'Account password not set. Please contact admin.' });
    }
    const isMatch = await bcrypt.compare(password, customer.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid mobile number or password' });
    }

    // Generate Token
    const payload = {
      id: customer.id,
      name: customer.name,
      mobile: customer.mobile,
      email: customer.email,
      role: 'customer'
    };
    
    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET || 'stock_management_jwt_secret_key_2026',
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token: token,
      customer: {
        id: customer.id,
        name: customer.name,
        mobile: customer.mobile,
        email: customer.email,
        address: customer.address
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Customer Profile
exports.customerProfile = async (req, res) => {
  res.json({ success: true, customer: req.user });
};

// Customer Orders History
exports.customerOrders = async (req, res) => {
  try {
    const customerMobile = req.user.mobile;
    const [orders] = await db.query(
      'SELECT id, order_number, subtotal, discount, gst_amount, shipping_charge, grand_total, status, order_date, created_at FROM orders WHERE customer_mobile = ? ORDER BY created_at DESC',
      [customerMobile]
    );

    for (let order of orders) {
      const [items] = await db.query(`
        SELECT oi.*, p.name as product_name, p.code as product_code, p.image as product_image
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `, [order.id]);
      order.items = items;
    }

    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Get permissions for logged-in user
exports.getPermissions = async (req, res) => {
  logDebug('[getPermissions] Hit endpoint. User: ' + JSON.stringify(req.user));
  try {
    const user = req.user;
    if (!user) {
      logDebug('[getPermissions] No user attached.');
      return res.status(401).json({ error: 'Unauthorized: Access token is missing or invalid' });
    }

    // Query database for fresh user role
    const [dbUsers] = await db.query(
      'SELECT a.role_id, r.name as role_name FROM admins a LEFT JOIN roles r ON a.role_id = r.id WHERE a.id = ? LIMIT 1',
      [user.id]
    );
    if (dbUsers.length === 0) {
      logDebug('[getPermissions] User account not found in DB.');
      return res.status(403).json({ error: 'Forbidden: User account not found' });
    }
    const dbUser = dbUsers[0];
    const roleName = dbUser.role_name;
    const roleId = dbUser.role_id;

    if (roleName === 'Owner') {
      logDebug('[getPermissions] User is Owner. Returning *');
      return res.json({ success: true, role: roleName, permissions: ['*'] });
    }

    logDebug('[getPermissions] User roleId: ' + roleId);
    if (!roleId) {
      logDebug('[getPermissions] No roleId found for user.');
      return res.json({ success: true, role: null, permissions: [] });
    }

    logDebug('[getPermissions] Querying role_permissions table...');
    // Query permissions
    const [perms] = await db.query(
      'SELECT module_name, action_name FROM role_permissions WHERE role_id = ?',
      [roleId]
    );
    logDebug('[getPermissions] Query completed. Number of permissions: ' + perms.length);

    const permissions = perms.map(p => `${p.module_name}:${p.action_name}`);

    logDebug('[getPermissions] Returning permissions to client.');
    res.json({
      success: true,
      role: roleName,
      roleId: roleId,
      permissions
    });
  } catch (error) {
    logDebug('[getPermissions] Error occurred: ' + error.stack);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
