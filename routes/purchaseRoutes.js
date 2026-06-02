const express = require('express');
const router = express.Router();
const purchaseController = require('../controllers/purchaseController');
const authMiddleware = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');

router.use(authMiddleware);

router.get('/', purchaseController.list);
router.get('/:id', purchaseController.get);
router.post('/', uploadMiddleware.single('thumbnail_image'), purchaseController.create);
router.put('/:id', uploadMiddleware.single('thumbnail_image'), purchaseController.update);
router.delete('/:id', purchaseController.delete);

module.exports = router;
