const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// Public endpoints
router.post('/', orderController.create);
router.get('/track/:orderNumber', orderController.track);

module.exports = router;
