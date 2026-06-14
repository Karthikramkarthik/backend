const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

router.get('/', authMiddleware, checkPermission('Suppliers', 'View'), supplierController.list);
router.get('/:id', authMiddleware, checkPermission('Suppliers', 'View'), supplierController.get);
router.get('/:id/purchases', authMiddleware, checkPermission('Suppliers', 'View'), supplierController.getPurchases);
router.post('/', authMiddleware, checkPermission('Suppliers', 'Create'), supplierController.create);
router.put('/:id', authMiddleware, checkPermission('Suppliers', 'Edit'), supplierController.update);
router.delete('/:id', authMiddleware, checkPermission('Suppliers', 'Delete'), supplierController.delete);

module.exports = router;
