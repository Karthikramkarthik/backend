const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Initialize express app
const app = express();

// Middlewares
app.use(cors()); // Allow all cross origins for development
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Static Upload Files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import Routes
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const productRoutes = require('./routes/productRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const customerRoutes = require('./routes/customerRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');
const salesRoutes = require('./routes/salesRoutes');
const fileManagerRoutes = require('./routes/fileManagerRoutes');
const reportRoutes = require('./routes/reportRoutes');

// Import new e-commerce and admin routes
const orderRoutes = require('./routes/orderRoutes');
const adminOrderRoutes = require('./routes/adminOrderRoutes');
const couponRoutes = require('./routes/couponRoutes');
const adminCouponRoutes = require('./routes/adminCouponRoutes');
const bannerRoutes = require('./routes/bannerRoutes');
const adminBannerRoutes = require('./routes/adminBannerRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const adminReviewRoutes = require('./routes/adminReviewRoutes');
const adminNotificationRoutes = require('./routes/adminNotificationRoutes');
const instagramRoutes = require('./routes/instagramRoutes');

// Bind Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/file-manager', fileManagerRoutes);
app.use('/api/reports', reportRoutes);

// Bind new routes
app.use('/api/orders', orderRoutes);
app.use('/api/admin/orders', adminOrderRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/admin/coupons', adminCouponRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/admin/banners', adminBannerRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/admin/reviews', adminReviewRoutes);
app.use('/api/admin/notifications', adminNotificationRoutes);
app.use('/api/instagram', instagramRoutes);

// Base route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Stock Management Node.js REST API!',
    status: 'Running'
  });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error stack:', err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Centralized server error!'
  });
});

// Start Express Server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Node.js REST API Server running on port ${PORT}`);
});
