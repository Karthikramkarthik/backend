const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', supplierController.list);
router.get('/:id', supplierController.get);
router.get('/:id/purchases', supplierController.getPurchases);
router.post('/', supplierController.create);
router.put('/:id', supplierController.update);
router.delete('/:id', supplierController.delete);

module.exports = router;
