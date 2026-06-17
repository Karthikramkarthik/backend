const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

router.get('/', authMiddleware, checkPermission('Sales', 'View'), salesController.list);
router.get('/price-audits', authMiddleware, checkPermission('Sales', 'View'), salesController.priceAudits);
router.get('/:id', authMiddleware, checkPermission('Sales', 'View'), salesController.get);
router.post('/', authMiddleware, checkPermission('Sales', 'Create'), salesController.create);
router.delete('/:id', authMiddleware, checkPermission('Sales', 'Delete'), salesController.delete);
router.put('/:id/status', authMiddleware, checkPermission('Sales', 'Edit'), salesController.updateStatus);
router.post('/:id/edit', authMiddleware, checkPermission('Sales', 'Edit'), salesController.edit);
router.get('/:id/audits', authMiddleware, checkPermission('Sales', 'View'), salesController.getAudits);

module.exports = router;
