const express = require('express');
const router = express.Router();
const fileManagerController = require('../controllers/fileManagerController');
const authMiddleware = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');
const { checkPermission } = require('../middleware/permission');

router.get('/', authMiddleware, checkPermission('File Manager', 'View'), fileManagerController.list);
router.post('/folder', authMiddleware, checkPermission('File Manager', 'Create'), fileManagerController.createFolder);
router.put('/folder/:id', authMiddleware, checkPermission('File Manager', 'Edit'), fileManagerController.renameFolder);
router.delete('/folder/:id', authMiddleware, checkPermission('File Manager', 'Delete'), fileManagerController.deleteFolder);
router.post('/upload', authMiddleware, checkPermission('File Manager', 'Create'), uploadMiddleware.array('images', 20), fileManagerController.uploadFiles);
router.delete('/file/:id', authMiddleware, checkPermission('File Manager', 'Delete'), fileManagerController.deleteFile);
router.post('/file/bulk-delete', authMiddleware, checkPermission('File Manager', 'Delete'), fileManagerController.bulkDeleteFiles);

module.exports = router;
