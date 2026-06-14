const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roleController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

// Role Management routes protected by token and permission validation
router.get('/', authMiddleware, checkPermission('Settings', 'View'), roleController.getRoles);
router.get('/audit-logs', authMiddleware, checkPermission('Settings', 'View'), roleController.getAuditLogs);
router.get('/:id', authMiddleware, checkPermission('Settings', 'View'), roleController.getRoleById);
router.post('/', authMiddleware, checkPermission('Settings', 'Create'), roleController.createRole);
router.put('/:id', authMiddleware, checkPermission('Settings', 'Edit'), roleController.updateRole);
router.delete('/:id', authMiddleware, checkPermission('Settings', 'Delete'), roleController.deleteRole);
router.post('/:id/clone', authMiddleware, checkPermission('Settings', 'Create'), roleController.cloneRole);
router.put('/:id/users', authMiddleware, checkPermission('Settings', 'Edit'), roleController.assignUsers);

module.exports = router;
