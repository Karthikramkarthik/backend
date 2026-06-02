const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', expenseController.list);
router.get('/:id', expenseController.get);
router.post('/', expenseController.create);
router.put('/:id', expenseController.update);
router.delete('/:id', expenseController.delete);

module.exports = router;
