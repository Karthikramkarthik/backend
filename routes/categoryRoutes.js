const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const authMiddleware = require('../middleware/auth');
const optionalAuth = authMiddleware.optional;
const { checkPermission } = require('../middleware/permission');

// Public endpoints
router.get('/', optionalAuth, categoryController.list);
router.get('/:id', optionalAuth, categoryController.get);

// Protected endpoints
router.post('/', authMiddleware, checkPermission('Categories', 'Create'), categoryController.create);
router.put('/:id', authMiddleware, checkPermission('Categories', 'Edit'), categoryController.update);
router.delete('/:id', authMiddleware, checkPermission('Categories', 'Delete'), categoryController.delete);

module.exports = router;
