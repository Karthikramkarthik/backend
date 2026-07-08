const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

router.get('/', authMiddleware, checkPermission('Reports', 'View'), reportController.getReports);
router.get('/customers-by-product', authMiddleware, checkPermission('Reports', 'View'), reportController.customersByProduct);
router.get('/customer-purchase-history/:customerId', authMiddleware, checkPermission('Reports', 'View'), reportController.customerPurchaseHistory);
router.get('/product-purchase-history/:productId', authMiddleware, checkPermission('Reports', 'View'), reportController.productPurchaseHistory);
router.get('/product-sold-details/:productId', authMiddleware, checkPermission('Reports', 'View'), reportController.productSoldDetails);
router.get('/revenue-history', authMiddleware, checkPermission('Reports', 'View'), reportController.revenueHistory);

module.exports = router;

