const express = require('express');
const router = express.Router();
const instagramController = require('../controllers/instagramController');
const authMiddleware = require('../middleware/auth');

// Public endpoints
router.get('/settings', instagramController.getSettings);
router.get('/reels', instagramController.listReels);

// Admin-only protected endpoints
router.get('/admin/reels', authMiddleware, instagramController.listAllReels);
router.put('/settings', authMiddleware, instagramController.updateSettings);
router.post('/reels', authMiddleware, instagramController.createReel);
router.delete('/reels/:id', authMiddleware, instagramController.deleteReel);

module.exports = router;
