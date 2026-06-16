const db = require('../config/database');

// In-memory cache for permissions
// Format: { [roleId]: { status: 'active'|'inactive', permissions: Set<"Module:Action"> } }
const permissionCache = {};

/**
 * Middleware to validate permissions on every request
 * @param {string} moduleName - Name of the module (e.g. Products, Sales)
 * @param {string} actionName - Name of the action (e.g. View, Create, Edit)
 */
function checkPermission(moduleName, actionName) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized: Access token is missing or invalid' });
      }

      // Query database for fresh user role and role status
      const [dbUsers] = await db.query(
        'SELECT a.role_id, r.name as role_name, r.status FROM admins a LEFT JOIN roles r ON a.role_id = r.id WHERE a.id = ? LIMIT 1',
        [user.id]
      );
      if (dbUsers.length === 0) {
        return res.status(403).json({ error: 'Forbidden: User account not found' });
      }
      const dbUser = dbUsers[0];

      // Owner role bypasses all checks
      if (dbUser.role_name === 'Owner') {
        return next();
      }

      const roleId = dbUser.role_id;
      if (!roleId) {
        return res.status(403).json({ error: 'Forbidden: No role assigned to user' });
      }

      // Check cache first
      let cached = permissionCache[roleId];

      if (!cached) {
        const roleStatus = dbUser.status;

        // Query permissions
        const [perms] = await db.query(
          'SELECT module_name, action_name FROM role_permissions WHERE role_id = ?',
          [roleId]
        );

        const permSet = new Set();
        perms.forEach(p => {
          permSet.add(`${p.module_name.toLowerCase()}:${p.action_name.toLowerCase()}`);
        });

        cached = {
          status: roleStatus,
          permissions: permSet
        };

        // Save to cache
        permissionCache[roleId] = cached;
      }

      // Check if role is enabled
      if (cached.status !== 'active') {
        return res.status(403).json({ error: 'Forbidden: Your user role has been disabled' });
      }

      // Validate permission matching
      const key = `${moduleName.toLowerCase()}:${actionName.toLowerCase()}`;
      if (cached.permissions.has(key)) {
        return next();
      }

      return res.status(403).json({ 
        error: `Forbidden: Insufficient permissions. Requires ${moduleName} -> ${actionName}` 
      });

    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({ error: 'Internal server authorization error' });
    }
  };
}

/**
 * Clear caching for a specific role or all roles
 * @param {number|null} roleId - Optional ID of the role to clear
 */
function clearPermissionCache(roleId = null) {
  if (roleId) {
    delete permissionCache[roleId];
    console.log(`Permission cache cleared for role ID: ${roleId}`);
  } else {
    Object.keys(permissionCache).forEach(key => {
      delete permissionCache[key];
    });
    console.log('Entire permission cache cleared');
  }
}

module.exports = {
  checkPermission,
  clearPermissionCache
};
