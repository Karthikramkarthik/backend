const express = require('express');
const router = express.Router();
const purchaseController = require('../controllers/purchaseController');
const authMiddleware = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');
const { checkPermission } = require('../middleware/permission');

router.get('/', authMiddleware, checkPermission('Purchases', 'View'), purchaseController.list);
router.get('/:id', authMiddleware, checkPermission('Purchases', 'View'), purchaseController.get);
router.post('/', authMiddleware, checkPermission('Purchases', 'Create'), uploadMiddleware.single('thumbnail_image'), purchaseController.create);
router.put('/:id', authMiddleware, checkPermission('Purchases', 'Edit'), uploadMiddleware.single('thumbnail_image'), purchaseController.update);
router.delete('/:id', authMiddleware, checkPermission('Purchases', 'Delete'), purchaseController.delete);

module.exports = router;
