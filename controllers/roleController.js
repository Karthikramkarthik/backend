const db = require('../config/database');
const { clearPermissionCache } = require('../middleware/permission');

// Helper to log audit changes
async function logAudit(userId, action, roleId, details) {
  try {
    await db.query(
      'INSERT INTO role_audit_logs (user_id, action, role_id, details) VALUES (?, ?, ?, ?)',
      [userId || null, action, roleId || null, details]
    );
  } catch (err) {
    console.error('Failed to write role audit log:', err);
  }
}

// Get all roles with member counts
exports.getRoles = async (req, res) => {
  try {
    const [roles] = await db.query(`
      SELECT r.*, COUNT(a.id) as user_count 
      FROM roles r 
      LEFT JOIN admins a ON a.role_id = r.id 
      GROUP BY r.id 
      ORDER BY r.is_system DESC, r.name ASC
    `);
    res.json({ success: true, roles });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Get single role with its permissions and users
exports.getRoleById = async (req, res) => {
  try {
    const { id } = req.params;

    const [roles] = await db.query('SELECT * FROM roles WHERE id = ? LIMIT 1', [id]);
    if (roles.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    const role = roles[0];

    const [permissions] = await db.query(
      'SELECT module_name, action_name FROM role_permissions WHERE role_id = ?',
      [id]
    );

    const [users] = await db.query(
      'SELECT id, username, email FROM admins WHERE role_id = ?',
      [id]
    );

    res.json({
      success: true,
      role,
      permissions,
      users
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Create a new role with permissions
exports.createRole = async (req, res) => {
  try {
    const { name, description, permissions } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Role name is required' });
    }

    // Check if role name already exists
    const [existing] = await db.query('SELECT id FROM roles WHERE name = ?', [name]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Role name already exists' });
    }

    const [result] = await db.query(
      'INSERT INTO roles (name, description, status, is_system) VALUES (?, ?, ?, 0)',
      [name, description || '', 'active']
    );
    const newRoleId = result.insertId;

    // Insert permissions if provided
    if (permissions && Array.isArray(permissions) && permissions.length > 0) {
      const insertValues = permissions.map(p => [newRoleId, p.module_name, p.action_name]);
      await db.query(
        'INSERT INTO role_permissions (role_id, module_name, action_name) VALUES ?',
        [insertValues]
      );
    }

    // Write audit log
    await logAudit(req.user?.id, 'create_role', newRoleId, `Created role "${name}"`);

    res.status(201).json({
      success: true,
      message: 'Role created successfully!',
      roleId: newRoleId
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Update role and its permissions
exports.updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, status, permissions } = req.body;

    const [roles] = await db.query('SELECT * FROM roles WHERE id = ? LIMIT 1', [id]);
    if (roles.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    const role = roles[0];

    // If system role, prevent renaming and prevent disabling Owner/Admin roles
    if (role.is_system) {
      if (name && name !== role.name) {
        return res.status(400).json({ error: 'System role names cannot be modified' });
      }
      if (status && status === 'inactive' && (role.name === 'Owner' || role.name === 'Admin')) {
        return res.status(400).json({ error: 'System root roles cannot be disabled' });
      }
    }

    // Check name duplicate
    if (name && name !== role.name) {
      const [duplicate] = await db.query('SELECT id FROM roles WHERE name = ? AND id != ?', [name, id]);
      if (duplicate.length > 0) {
        return res.status(400).json({ error: 'Role name already exists' });
      }
    }

    // Update role details
    await db.query(
      'UPDATE roles SET name = ?, description = ?, status = ? WHERE id = ?',
      [name || role.name, description !== undefined ? description : role.description, status || role.status, id]
    );

    // Update permissions if provided
    if (permissions && Array.isArray(permissions)) {
      // Delete existing
      await db.query('DELETE FROM role_permissions WHERE role_id = ?', [id]);

      // Insert new
      if (permissions.length > 0) {
        const insertValues = permissions.map(p => [id, p.module_name, p.action_name]);
        await db.query(
          'INSERT INTO role_permissions (role_id, module_name, action_name) VALUES ?',
          [insertValues]
        );
      }
    }

    // Clear role cache
    clearPermissionCache(id);

    // Write audit log
    await logAudit(req.user?.id, 'update_role', id, `Updated role "${name || role.name}" details and permissions`);

    res.json({ success: true, message: 'Role updated successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Delete role
exports.deleteRole = async (req, res) => {
  try {
    const { id } = req.params;

    const [roles] = await db.query('SELECT * FROM roles WHERE id = ? LIMIT 1', [id]);
    if (roles.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    const role = roles[0];

    // Prevent system role deletion
    if (role.is_system) {
      return res.status(400).json({ error: 'Default system roles cannot be deleted' });
    }

    // Delete role (cascades permissions automatically due to foreign key constraints)
    await db.query('DELETE FROM roles WHERE id = ?', [id]);

    // Clear role cache
    clearPermissionCache(id);

    // Write audit log
    await logAudit(req.user?.id, 'delete_role', id, `Deleted role "${role.name}"`);

    res.json({ success: true, message: 'Role deleted successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Clone role
exports.cloneRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Cloned role name is required' });
    }

    const [roles] = await db.query('SELECT * FROM roles WHERE id = ? LIMIT 1', [id]);
    if (roles.length === 0) {
      return res.status(404).json({ error: 'Source role not found' });
    }
    const sourceRole = roles[0];

    // Check name duplicate
    const [duplicate] = await db.query('SELECT id FROM roles WHERE name = ?', [name]);
    if (duplicate.length > 0) {
      return res.status(400).json({ error: 'Role name already exists' });
    }

    // Create new role
    const [result] = await db.query(
      'INSERT INTO roles (name, description, status, is_system) VALUES (?, ?, ?, 0)',
      [name, description || `Clone of ${sourceRole.name}`, 'active']
    );
    const newRoleId = result.insertId;

    // Get source permissions
    const [sourcePerms] = await db.query(
      'SELECT module_name, action_name FROM role_permissions WHERE role_id = ?',
      [id]
    );

    // Copy permissions to new role
    if (sourcePerms.length > 0) {
      const insertValues = sourcePerms.map(p => [newRoleId, p.module_name, p.action_name]);
      await db.query(
        'INSERT INTO role_permissions (role_id, module_name, action_name) VALUES ?',
        [insertValues]
      );
    }

    // Write audit log
    await logAudit(req.user?.id, 'clone_role', newRoleId, `Cloned role "${sourceRole.name}" to "${name}"`);

    res.status(201).json({
      success: true,
      message: 'Role cloned successfully!',
      roleId: newRoleId
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Assign multiple users to a role
exports.assignUsers = async (req, res) => {
  try {
    const { id } = req.params; // Role ID
    const { userIds } = req.body; // Array of user IDs

    if (!Array.isArray(userIds)) {
      return res.status(400).json({ error: 'userIds must be an array of numbers' });
    }

    const [roles] = await db.query('SELECT * FROM roles WHERE id = ? LIMIT 1', [id]);
    if (roles.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    const role = roles[0];

    // Clear previous assignments to this role
    await db.query('UPDATE admins SET role_id = NULL WHERE role_id = ?', [id]);

    // Update selected users to have this role ID
    if (userIds.length > 0) {
      await db.query('UPDATE admins SET role_id = ? WHERE id IN (?)', [id, userIds]);
    }

    // Write audit log
    await logAudit(
      req.user?.id,
      'assign_users',
      id,
      `Assigned ${userIds.length} users to role "${role.name}"`
    );

    res.json({ success: true, message: 'Users assigned to role successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Get role change history audit logs
exports.getAuditLogs = async (req, res) => {
  try {
    const [logs] = await db.query(`
      SELECT l.*, a.username as performer_username, r.name as role_name 
      FROM role_audit_logs l 
      LEFT JOIN admins a ON l.user_id = a.id 
      LEFT JOIN roles r ON l.role_id = r.id
      ORDER BY l.created_at DESC
    `);
    res.json({ success: true, auditLogs: logs });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
