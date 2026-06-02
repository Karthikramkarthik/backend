const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');

// Public validation endpoint
router.post('/validate', couponController.validate);

module.exports = router;
