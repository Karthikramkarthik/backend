const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const authMiddleware = require('../middleware/auth');

// Guard all administrative coupon endpoints with JWT
router.use(authMiddleware);

router.get('/', couponController.list);
router.get('/:id', couponController.get);
router.post('/', couponController.create);
router.put('/:id', couponController.update);
router.delete('/:id', couponController.delete);

module.exports = router;
