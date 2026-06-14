const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/bannerController');
const authMiddleware = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');
const { checkPermission } = require('../middleware/permission');

router.get('/', authMiddleware, checkPermission('Settings', 'View'), bannerController.listAll);
router.get('/:id', authMiddleware, checkPermission('Settings', 'View'), bannerController.get);
router.post('/', authMiddleware, checkPermission('Settings', 'Manage Settings'), uploadMiddleware.single('image'), bannerController.create);
router.put('/:id', authMiddleware, checkPermission('Settings', 'Manage Settings'), uploadMiddleware.single('image'), bannerController.update);
router.delete('/:id', authMiddleware, checkPermission('Settings', 'Manage Settings'), bannerController.delete);

module.exports = router;
