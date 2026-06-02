const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/bannerController');
const authMiddleware = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');

// Guard all administrative banner endpoints with JWT
router.use(authMiddleware);

router.get('/', bannerController.listAll);
router.get('/:id', bannerController.get);
router.post('/', uploadMiddleware.single('image'), bannerController.create);
router.put('/:id', uploadMiddleware.single('image'), bannerController.update);
router.delete('/:id', bannerController.delete);

module.exports = router;
