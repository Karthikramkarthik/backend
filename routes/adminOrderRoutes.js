const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const authMiddleware = require('../middleware/auth');

// Guard all administrative order endpoints with JWT
router.use(authMiddleware);

router.get('/', orderController.list);
router.get('/:id', orderController.get);
router.put('/:id/status', orderController.updateStatus);

module.exports = router;
