const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

router.get('/', authMiddleware, checkPermission('Customers', 'View'), customerController.list);
router.get('/:id', authMiddleware, checkPermission('Customers', 'View'), customerController.get);
router.post('/', authMiddleware, checkPermission('Customers', 'Create'), customerController.create);
router.put('/:id', authMiddleware, checkPermission('Customers', 'Edit'), customerController.update);
router.delete('/:id', authMiddleware, checkPermission('Customers', 'Delete'), customerController.delete);

module.exports = router;
