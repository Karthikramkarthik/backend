const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const authMiddleware = require('../middleware/auth');
const { checkPermission } = require('../middleware/permission');

router.get('/', authMiddleware, checkPermission('Coupons', 'View'), couponController.list);
router.get('/:id', authMiddleware, checkPermission('Coupons', 'View'), couponController.get);
router.post('/', authMiddleware, checkPermission('Coupons', 'Create'), couponController.create);
router.put('/:id', authMiddleware, checkPermission('Coupons', 'Edit'), couponController.update);
router.delete('/:id', authMiddleware, checkPermission('Coupons', 'Delete'), couponController.delete);

module.exports = router;
