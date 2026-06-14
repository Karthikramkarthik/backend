const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

router.get('/', authMiddleware, checkPermission('Orders', 'View'), orderController.list);
router.get('/summary', authMiddleware, checkPermission('Orders', 'View'), orderController.summary);
router.get('/:id', authMiddleware, checkPermission('Orders', 'View'), orderController.get);
router.put('/:id/status', authMiddleware, checkPermission('Orders', 'Edit'), orderController.updateStatus);
router.delete('/:id', authMiddleware, checkPermission('Orders', 'Delete'), orderController.delete);
router.post('/:id/invoice', authMiddleware, checkPermission('Orders', 'View'), orderController.getInvoice);

module.exports = router;
