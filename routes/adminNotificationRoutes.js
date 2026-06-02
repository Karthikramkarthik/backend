const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const authMiddleware = require('../middleware/auth');

// Guard all notifications endpoints with JWT
router.use(authMiddleware);

router.get('/', notificationController.list);
router.put('/read-all', notificationController.markAllRead);
router.put('/:id/read', notificationController.markAsRead);

module.exports = router;
