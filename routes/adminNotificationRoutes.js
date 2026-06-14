const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

router.get('/', authMiddleware, checkPermission('Dashboard', 'View'), notificationController.list);
router.put('/read-all', authMiddleware, checkPermission('Dashboard', 'Edit'), notificationController.markAllRead);
router.put('/:id/read', authMiddleware, checkPermission('Dashboard', 'Edit'), notificationController.markAsRead);

module.exports = router;
