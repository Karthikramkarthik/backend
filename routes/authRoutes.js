const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

// Admin Auth Routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/change-password', authMiddleware, authController.changePassword);
router.get('/profile', authMiddleware, authController.getProfile);

// Customer E-Commerce Auth Routes
router.post('/customer/register', authController.customerRegister);
router.post('/customer/login', authController.customerLogin);
router.get('/customer/profile', authMiddleware, authController.customerProfile);
router.get('/customer/orders', authMiddleware, authController.customerOrders);

module.exports = router;
