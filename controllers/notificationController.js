const db = require('../config/database');

// 1. Get recent notifications & unread count (Admin)
exports.list = async (req, res) => {
  try {
    // Fetch last 50 notifications
    const [notifications] = await db.query(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50'
    );

    // Fetch unread count
    const [countRows] = await db.query(
      'SELECT COUNT(*) as unreadCount FROM notifications WHERE is_read = 0'
    );

    const unreadCount = countRows[0].unreadCount;

    res.json({
      success: true,
      unreadCount,
      notifications
    });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 2. Mark a single notification as read (Admin)
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query('UPDATE notifications SET is_read = 1 WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true, message: 'Notification marked as read' });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 3. Mark all notifications as read (Admin)
exports.markAllRead = async (req, res) => {
  try {
    await db.query('UPDATE notifications SET is_read = 1 WHERE is_read = 0');
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
