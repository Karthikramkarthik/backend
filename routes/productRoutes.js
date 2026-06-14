const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const authMiddleware = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');
const { checkPermission } = require('../middleware/permission');

// Public endpoints (no login required for customer storefront browsing)
router.get('/', productController.list);
router.get('/:id', productController.get);
router.post('/:id/viewers', productController.trackViewer);

// Protected endpoints (admin operations)
router.post('/', authMiddleware, checkPermission('Products', 'Create'), uploadMiddleware.any(), productController.create);
router.put('/:id', authMiddleware, checkPermission('Products', 'Edit'), uploadMiddleware.any(), productController.update);
router.delete('/:id', authMiddleware, checkPermission('Products', 'Delete'), productController.delete);
router.post('/import', authMiddleware, checkPermission('Products', 'Create'), uploadMiddleware.single('product_file'), productController.import);

module.exports = router;
