const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

router.get('/', authMiddleware, checkPermission('Expenses', 'View'), expenseController.list);
router.get('/:id', authMiddleware, checkPermission('Expenses', 'View'), expenseController.get);
router.post('/', authMiddleware, checkPermission('Expenses', 'Create'), expenseController.create);
router.put('/:id', authMiddleware, checkPermission('Expenses', 'Edit'), expenseController.update);
router.delete('/:id', authMiddleware, checkPermission('Expenses', 'Delete'), expenseController.delete);

module.exports = router;
