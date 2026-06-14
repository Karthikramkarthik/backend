const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

router.get('/', authMiddleware, checkPermission('Products', 'View'), reviewController.listAll);
router.put('/:id/status', authMiddleware, checkPermission('Products', 'Approve'), reviewController.updateStatus);

module.exports = router;
