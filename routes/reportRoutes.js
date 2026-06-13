const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', reportController.getReports);
router.get('/customers-by-product', reportController.customersByProduct);
router.get('/customer-purchase-history/:customerId', reportController.customerPurchaseHistory);

module.exports = router;

