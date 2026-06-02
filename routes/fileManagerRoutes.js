const express = require('express');
const router = express.Router();
const fileManagerController = require('../controllers/fileManagerController');
const authMiddleware = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');

router.use(authMiddleware);

router.get('/', fileManagerController.list);
router.post('/folder', fileManagerController.createFolder);
router.put('/folder/:id', fileManagerController.renameFolder);
router.delete('/folder/:id', fileManagerController.deleteFolder);
router.post('/upload', uploadMiddleware.array('images', 20), fileManagerController.uploadFiles);
router.delete('/file/:id', fileManagerController.deleteFile);
router.post('/file/bulk-delete', fileManagerController.bulkDeleteFiles);

module.exports = router;
