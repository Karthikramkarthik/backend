const express = require('express');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Initialize express app
const app = express();

// Middlewares
app.use(compression());
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
const searchRoutes = require('./routes/searchRoutes');
const roleRoutes = require('./routes/roleRoutes');
const userRoutes = require('./routes/userRoutes');

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
const systemSettingsRoutes = require('./routes/systemSettingsRoutes');
const internalConsumptionRoutes = require('./routes/internalConsumptionRoutes');

// Bind Routes
app.get('/api/pool-status', (req, res) => {
  const pool = require('./config/database');
  const underlyingPool = pool.pool;
  res.json({
    totalConnections: underlyingPool && underlyingPool._allConnections ? underlyingPool._allConnections.length : (pool._allConnections ? pool._allConnections.length : null),
    freeConnections: underlyingPool && underlyingPool._freeConnections ? underlyingPool._freeConnections.length : (pool._freeConnections ? pool._freeConnections.length : null),
    queuedRequests: underlyingPool && underlyingPool._connectionQueue ? underlyingPool._connectionQueue.length : (pool._connectionQueue ? pool._connectionQueue.length : null)
  });
});
app.get('/api/test-db-query', async (req, res) => {
  try {
    const db = require('./config/database');
    const [result] = await db.query("SELECT module_name, action_name FROM role_permissions WHERE role_id = 6");
    res.json({ success: true, result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});
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
app.use('/api/search', searchRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/users', userRoutes);

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
app.use('/api/settings', systemSettingsRoutes);
app.use('/api/internal-consumption', internalConsumptionRoutes);

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
