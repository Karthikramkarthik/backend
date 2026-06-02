const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const authMiddleware = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');

// Public endpoints (no login required for customer storefront browsing)
router.get('/', productController.list);
router.get('/:id', productController.get);

// Protected endpoints (admin operations)
router.post('/', authMiddleware, uploadMiddleware.fields([
  { name: 'image', maxCount: 1 },
  { name: 'image_back', maxCount: 1 },
  { name: 'image_side', maxCount: 1 },
  { name: 'image_detail', maxCount: 1 }
]), productController.create);
router.put('/:id', authMiddleware, uploadMiddleware.fields([
  { name: 'image', maxCount: 1 },
  { name: 'image_back', maxCount: 1 },
  { name: 'image_side', maxCount: 1 },
  { name: 'image_detail', maxCount: 1 }
]), productController.update);
router.delete('/:id', authMiddleware, productController.delete);
router.post('/import', authMiddleware, uploadMiddleware.single('product_file'), productController.import);

module.exports = router;
