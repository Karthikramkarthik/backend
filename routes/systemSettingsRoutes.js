const express = require('express');
const router = express.Router();
const systemSettingsController = require('../controllers/systemSettingsController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

// Public settings route for cart and calculations
router.get('/', systemSettingsController.getSettings);

// Protected update route for Admin settings page
router.put('/', authMiddleware, checkPermission('Settings', 'Manage Settings'), systemSettingsController.updateSettings);

module.exports = router;
