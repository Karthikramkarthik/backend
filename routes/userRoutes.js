const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

// User Management routes protected by token and module permission validation
router.get('/', authMiddleware, checkPermission('Users', 'View'), userController.getUsers);
router.post('/', authMiddleware, checkPermission('Users', 'Create'), userController.createUser);
router.put('/:id', authMiddleware, checkPermission('Users', 'Edit'), userController.updateUser);
router.delete('/:id', authMiddleware, checkPermission('Users', 'Delete'), userController.deleteUser);

module.exports = router;
