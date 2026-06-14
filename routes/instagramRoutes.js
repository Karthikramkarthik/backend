const express = require('express');
const router = express.Router();
const instagramController = require('../controllers/instagramController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

// Public endpoints
router.get('/settings', instagramController.getSettings);
router.get('/reels', instagramController.listReels);

// Admin-only protected endpoints
router.get('/admin/reels', authMiddleware, checkPermission('Settings', 'View'), instagramController.listAllReels);
router.put('/settings', authMiddleware, checkPermission('Settings', 'Manage Settings'), instagramController.updateSettings);
router.post('/reels', authMiddleware, checkPermission('Settings', 'Manage Settings'), instagramController.createReel);
router.delete('/reels/:id', authMiddleware, checkPermission('Settings', 'Manage Settings'), instagramController.deleteReel);

module.exports = router;
