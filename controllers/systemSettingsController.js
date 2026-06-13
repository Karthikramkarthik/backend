const db = require('../config/database');

// GET /api/settings
exports.getSettings = async (req, res) => {
  try {
    const [settings] = await db.query('SELECT key_name, value, display_name, updated_by, updated_at FROM settings');
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// PUT /api/settings
exports.updateSettings = async (req, res) => {
  try {
    const settingsUpdates = req.body; // Expecting an object like { gst_percentage: 12, shipping_fixed: 100, shipping_threshold: 1500 }
    
    if (!settingsUpdates || typeof settingsUpdates !== 'object') {
      return res.status(400).json({ error: 'Invalid settings payload format' });
    }

    const updatedBy = req.user ? (req.user.username || req.user.email || 'Admin') : 'Admin';

    // Begin transaction to update all keys safely
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      for (const [key, value] of Object.entries(settingsUpdates)) {
        // Validation checks
        const parsedVal = parseFloat(value);
        if (isNaN(parsedVal)) {
          throw new Error(`Value for key ${key} must be a valid number`);
        }

        if (key === 'gst_percentage') {
          if (parsedVal < 0 || parsedVal > 100) {
            throw new Error('GST percentage must be between 0 and 100');
          }
        } else if (key === 'shipping_fixed') {
          if (parsedVal < 0) {
            throw new Error('Shipping fixed charge must be a non-negative number');
          }
        } else if (key === 'shipping_threshold') {
          if (parsedVal < 0) {
            throw new Error('Shipping free threshold must be a non-negative number');
          }
        } else if (key === 'viewer_count_enabled') {
          if (parsedVal !== 0 && parsedVal !== 1) {
            throw new Error('Viewer count enabled setting must be 0 or 1');
          }
        }
        const [result] = await connection.query(
          'UPDATE settings SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE key_name = ?',
          [String(parsedVal), updatedBy, key]
        );
        
        if (result.affectedRows === 0) {
          throw new Error(`Setting key "${key}" not found in database`);
        }
      }

      await connection.commit();
      connection.release();

      res.json({ success: true, message: 'Settings updated successfully!' });
    } catch (err) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ error: err.message });
    }
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
