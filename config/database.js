const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 8889,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'root',
  database: process.env.DB_NAME || 'stock_management',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test database connection and auto-migrate tables on load
(async () => {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('Connected to MySQL Database successfully via connection pool.');

    // Ensure tax-related columns exist in purchases table
    try {
      await connection.query('ALTER TABLE `purchases` ADD COLUMN `subtotal` decimal(12,2) DEFAULT NULL AFTER `supplier_id`');
      console.log('Database auto-migration: Added subtotal column to purchases table.');
    } catch (err) {}
    try {
      await connection.query("ALTER TABLE `purchases` ADD COLUMN `tax_type` enum('fixed', 'percentage') DEFAULT NULL AFTER `subtotal`");
      console.log('Database auto-migration: Added tax_type column to purchases table.');
    } catch (err) {}
    try {
      await connection.query('ALTER TABLE `purchases` ADD COLUMN `tax_rate` decimal(10,2) DEFAULT NULL AFTER `tax_type`');
      console.log('Database auto-migration: Added tax_rate column to purchases table.');
    } catch (err) {}
    try {
      await connection.query('ALTER TABLE `purchases` ADD COLUMN `tax_amount` decimal(12,2) DEFAULT NULL AFTER `tax_rate`');
      console.log('Database auto-migration: Added tax_amount column to purchases table.');
    } catch (err) {}

    // 1. Migrate orders table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`orders\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`order_number\` varchar(50) NOT NULL,
        \`customer_name\` varchar(100) NOT NULL,
        \`customer_mobile\` varchar(20) NOT NULL,
        \`customer_email\` varchar(100) DEFAULT NULL,
        \`shipping_address\` text NOT NULL,
        \`payment_method\` varchar(50) DEFAULT 'COD',
        \`subtotal\` decimal(12,2) NOT NULL,
        \`discount\` decimal(10,2) DEFAULT 0,
        \`gst_amount\` decimal(10,2) DEFAULT 0,
        \`shipping_charge\` decimal(10,2) DEFAULT 0,
        \`grand_total\` decimal(12,2) NOT NULL,
        \`status\` enum('Pending','Processing','Shipped','Delivered','Cancelled','Returned') DEFAULT 'Pending',
        \`order_date\` date NOT NULL,
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`order_number\` (\`order_number\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Migrate order_items table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`order_items\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`order_id\` int(11) NOT NULL,
        \`product_id\` int(11) NOT NULL,
        \`quantity\` int(11) NOT NULL,
        \`price\` decimal(10,2) NOT NULL,
        \`total\` decimal(10,2) NOT NULL,
        PRIMARY KEY (\`id\`),
        FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE CASCADE,
        FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. Migrate coupons table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`coupons\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`code\` varchar(50) NOT NULL,
        \`type\` enum('fixed','percentage') NOT NULL,
        \`value\` decimal(10,2) NOT NULL,
        \`min_order_amount\` decimal(10,2) DEFAULT 0,
        \`expiry_date\` date NOT NULL,
        \`usage_limit\` int(11) DEFAULT 0,
        \`used_count\` int(11) DEFAULT 0,
        \`status\` enum('active','inactive') DEFAULT 'active',
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`code\` (\`code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed default coupons if coupons table is empty
    const [couponCountRows] = await connection.query('SELECT COUNT(*) as count FROM coupons');
    if (couponCountRows[0].count === 0) {
      await connection.query(`
        INSERT INTO \`coupons\` (\`code\`, \`type\`, \`value\`, \`min_order_amount\`, \`expiry_date\`, \`usage_limit\`, \`status\`) VALUES
        ('WELCOME10', 'percentage', 10.00, 500.00, '2026-12-31', 100, 'active'),
        ('FLAT500', 'fixed', 500.00, 2000.00, '2026-12-31', 50, 'active')
      `);
      console.log('Seeded default coupons table entries.');
    }

    // 4. Migrate banners table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`banners\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`title\` varchar(150) NOT NULL,
        \`subtitle\` varchar(255) DEFAULT NULL,
        \`image\` varchar(255) NOT NULL,
        \`redirect_url\` varchar(255) DEFAULT NULL,
        \`display_order\` int(11) DEFAULT 0,
        \`status\` enum('active','inactive') DEFAULT 'active',
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 5. Migrate reviews table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`reviews\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`product_id\` int(11) NOT NULL,
        \`customer_name\` varchar(100) NOT NULL,
        \`rating\` int(11) NOT NULL,
        \`review_message\` text NOT NULL,
        \`status\` enum('Pending','Approved','Rejected') DEFAULT 'Pending',
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 6. Migrate inventory_history table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`inventory_history\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`product_id\` int(11) NOT NULL,
        \`change_quantity\` int(11) NOT NULL,
        \`action_type\` varchar(50) NOT NULL,
        \`reference_id\` int(11) DEFAULT NULL,
        \`reference_number\` varchar(50) DEFAULT NULL,
        \`notes\` varchar(255) DEFAULT NULL,
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 7. Migrate notifications table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`notifications\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`type\` enum('new_order','low_stock','new_customer','review') NOT NULL,
        \`message\` varchar(255) NOT NULL,
        \`reference_id\` int(11) DEFAULT NULL,
        \`is_read\` tinyint(1) DEFAULT 0,
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 8. Migrate customers table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`customers\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`name\` varchar(100) NOT NULL,
        \`mobile\` varchar(20) NOT NULL,
        \`email\` varchar(100) DEFAULT NULL,
        \`password\` varchar(255) DEFAULT NULL,
        \`address\` text DEFAULT NULL,
        \`status\` enum('active','inactive') DEFAULT 'active',
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`mobile\` (\`mobile\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure password column exists in customers table in case table was pre-created
    try {
      await connection.query('ALTER TABLE `customers` ADD COLUMN `password` varchar(255) DEFAULT NULL AFTER `email`');
      console.log('Database auto-migration: Added password column to customers table.');
    } catch (err) {
      // Column already exists, safe to ignore
    }

    // Ensure source column exists in customers table
    try {
      await connection.query("ALTER TABLE `customers` ADD COLUMN `source` enum('Website', 'Admin Panel', 'POS', 'Import') NOT NULL DEFAULT 'Admin Panel' AFTER `address`");
      console.log('Database auto-migration: Added source column to customers table.');
    } catch (err) {
      // Column already exists, safe to ignore
    }


    // Ensure back, side, detail view image columns exist in products table
    try {
      await connection.query('ALTER TABLE `products` ADD COLUMN `image_back` varchar(255) DEFAULT NULL AFTER `image`');
      console.log('Database auto-migration: Added image_back column to products table.');
    } catch (err) {}
    try {
      await connection.query('ALTER TABLE `products` ADD COLUMN `image_side` varchar(255) DEFAULT NULL AFTER `image_back`');
      console.log('Database auto-migration: Added image_side column to products table.');
    } catch (err) {}
    try {
      await connection.query('ALTER TABLE `products` ADD COLUMN `image_detail` varchar(255) DEFAULT NULL AFTER `image_side`');
      console.log('Database auto-migration: Added image_detail column to products table.');
    } catch (err) {}
    try {
      await connection.query('ALTER TABLE `products` ADD COLUMN `thumbnail` varchar(255) DEFAULT NULL AFTER `image_detail`');
      console.log('Database auto-migration: Added thumbnail column to products table.');
    } catch (err) {}
    try {
      await connection.query('ALTER TABLE `products` ADD COLUMN `actual_price` decimal(10,2) DEFAULT NULL AFTER `purchase_price`');
      console.log('Database auto-migration: Added actual_price column to products table.');
    } catch (err) {}
    try {
      await connection.query('ALTER TABLE `products` ADD COLUMN `discount_percent` int(11) DEFAULT 0 AFTER `actual_price`');
      console.log('Database auto-migration: Added discount_percent column to products table.');
    } catch (err) {}
    try {
      await connection.query('ALTER TABLE `products` ADD COLUMN `initial_stock_quantity` int(11) DEFAULT 0 AFTER `stock_quantity`');
      console.log('Database auto-migration: Added initial_stock_quantity column to products table.');
    } catch (err) {}

    // Ensure gst_number column exists in suppliers table
    try {
      await connection.query('ALTER TABLE `suppliers` ADD COLUMN `gst_number` varchar(50) DEFAULT NULL AFTER `mobile`');
      console.log('Database auto-migration: Added gst_number column to suppliers table.');
    } catch (err) {}

    // 9. Migrate instagram_settings table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`instagram_settings\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`profile_url\` varchar(255) NOT NULL DEFAULT 'https://www.instagram.com/kids_boutique',
        \`is_enabled\` tinyint(1) NOT NULL DEFAULT 1,
        \`reels_count\` int(11) NOT NULL DEFAULT 6,
        \`section_title\` varchar(255) NOT NULL DEFAULT '✨ Capture The Sparkle on Instagram',
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed default settings if empty
    const [settingsCount] = await connection.query('SELECT COUNT(*) as count FROM instagram_settings');
    if (settingsCount[0].count === 0) {
      await connection.query(`
        INSERT INTO \`instagram_settings\` (\`profile_url\`, \`is_enabled\`, \`reels_count\`, \`section_title\`)
        VALUES ('https://www.instagram.com/kids_boutique_diaries', 1, 6, '✨ Capture The Sparkle on Instagram')
      `);
      console.log('Seeded default instagram settings.');
    }

    // 10. Migrate instagram_reels table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`instagram_reels\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`thumbnail_url\` varchar(500) NOT NULL,
        \`video_url\` varchar(500) NOT NULL,
        \`caption\` varchar(500) DEFAULT NULL,
        \`publish_date\` datetime DEFAULT CURRENT_TIMESTAMP,
        \`instagram_url\` varchar(500) DEFAULT NULL,
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed default reels if empty
    const [reelsCount] = await connection.query('SELECT COUNT(*) as count FROM instagram_reels');
    if (reelsCount[0].count === 0) {
      await connection.query(`
        INSERT INTO \`instagram_reels\` (\`thumbnail_url\`, \`video_url\`, \`caption\`, \`publish_date\`, \`instagram_url\`) VALUES
        ('https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=600&auto=format&fit=crop', 'https://assets.mixkit.co/videos/preview/mixkit-toddler-girl-playing-with-toys-48866-large.mp4', '🎨 Messy hands and creative minds! Exploring new pastel puzzles today at our baby activity workshop. #kidsplay #organicclothing', NOW(), 'https://www.instagram.com/reel/C8a1b2c3d4/'),
        ('https://images.unsplash.com/photo-1503919545889-aef636e10ad4?q=80&w=600&auto=format&fit=crop', 'https://assets.mixkit.co/videos/preview/mixkit-little-child-playing-with-a-colorful-toy-42353-large.mp4', '🌈 Summer dresses made for pure joy! Extremely soft cotton fabric, certified 100% skin-safe for toddlers. #kidswear #summerboutique', NOW() - INTERVAL 1 DAY, 'https://www.instagram.com/reel/C8e5f6g7h8/'),
        ('https://images.unsplash.com/photo-1515488042361-404e9250afef?q=80&w=600&auto=format&fit=crop', 'https://assets.mixkit.co/videos/preview/mixkit-toddler-boy-playing-on-the-grass-48863-large.mp4', '🌿 Outdoor active plays in hyper-stretch overalls. Let them explore the summer nature comfortably! ☀️ #toddlervibe #playwear', NOW() - INTERVAL 2 DAY, 'https://www.instagram.com/reel/C8i9j0k1l2/'),
        ('https://images.unsplash.com/photo-1544816155-12df9643f363?q=80&w=600&auto=format&fit=crop', 'https://assets.mixkit.co/videos/preview/mixkit-baby-playing-in-a-crib-with-toys-48868-large.mp4', '💤 Dreaming high in organic cotton sleepwear sets. Keep them cozy and happy through cozy naps. #babyessentials #babysleep', NOW() - INTERVAL 3 DAY, 'https://www.instagram.com/reel/C8m3n4o5p6/')
      `);
      console.log('Seeded default mock instagram reels.');
    }

    // 11. Migrate product_colors table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`product_colors\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`product_id\` int(11) NOT NULL,
        \`color_name\` varchar(100) NOT NULL,
        \`image_path\` varchar(255) DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure size and color columns exist in order_items table
    try {
      await connection.query('ALTER TABLE `order_items` ADD COLUMN `size` varchar(50) DEFAULT NULL AFTER `price`');
      console.log('Database auto-migration: Added size column to order_items table.');
    } catch (err) {}
    try {
      await connection.query('ALTER TABLE `order_items` ADD COLUMN `color` varchar(50) DEFAULT NULL AFTER `size`');
      console.log('Database auto-migration: Added color column to order_items table.');
    } catch (err) {}

    // Ensure status column in orders supports 'Returned'
    try {
      await connection.query("ALTER TABLE `orders` MODIFY COLUMN `status` enum('Pending','Processing','Shipped','Delivered','Cancelled','Returned') DEFAULT 'Pending'");
      console.log('Database auto-migration: Updated status enum to include Returned in orders table.');
    } catch (err) {
      console.error('Failed to update status enum in orders table:', err);
    }

    // Ensure payment_method column in sales exists
    try {
      await connection.query("ALTER TABLE `sales` ADD COLUMN `payment_method` varchar(50) DEFAULT 'Cash' AFTER `invoice_number`");
      console.log('Database auto-migration: Added payment_method column to sales table.');
    } catch (err) {
      // Column already exists, safe to ignore
    }

    // 12. Migrate settings table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`settings\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`key_name\` varchar(50) NOT NULL,
        \`value\` varchar(255) NOT NULL,
        \`display_name\` varchar(100) NOT NULL,
        \`updated_by\` varchar(100) DEFAULT NULL,
        \`updated_at\` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`key_name\` (\`key_name\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed default settings if empty
    const [settingsTableCount] = await connection.query('SELECT COUNT(*) as count FROM settings');
    if (settingsTableCount[0].count === 0) {
      await connection.query(`
        INSERT INTO \`settings\` (\`key_name\`, \`value\`, \`display_name\`, \`updated_by\`) VALUES
        ('gst_percentage', '5', 'Estimated GST (%)', 'System'),
        ('shipping_fixed', '100', 'Fixed Shipping Charge (₹)', 'System'),
        ('shipping_threshold', '1500', 'Free Shipping Threshold (₹)', 'System')
      `);
      console.log('Seeded default system settings.');
    }

    // Ensure viewer_count_enabled exists in settings table
    try {
      const [checkViewerCount] = await connection.query("SELECT id FROM settings WHERE key_name = 'viewer_count_enabled'");
      if (checkViewerCount.length === 0) {
        await connection.query("INSERT INTO settings (key_name, value, display_name, updated_by) VALUES ('viewer_count_enabled', '1', 'Enable Live Viewer Count', 'System')");
        console.log('Database auto-migration: Added viewer_count_enabled setting.');
      }
    } catch (err) {
      console.error('Failed to auto-migrate viewer_count_enabled setting:', err.message);
    }

    // Ensure invoice_number column exists in orders table
    try {
      await connection.query('ALTER TABLE `orders` ADD COLUMN `invoice_number` varchar(50) DEFAULT NULL AFTER `status`');
      console.log('Database auto-migration: Added invoice_number column to orders table.');
    } catch (err) {
      // Column already exists, safe to ignore
    }

    // Ensure order_number column exists in sales table
    try {
      await connection.query('ALTER TABLE `sales` ADD COLUMN `order_number` varchar(50) DEFAULT NULL AFTER `invoice_number`');
      console.log('Database auto-migration: Added order_number column to sales table.');
    } catch (err) {
      // Column already exists, safe to ignore
    }

    // Ensure status column exists in sales table
    try {
      await connection.query("ALTER TABLE `sales` ADD COLUMN `status` enum('Generated', 'Sent') NOT NULL DEFAULT 'Generated' AFTER `sale_date`");
      console.log('Database auto-migration: Added status column to sales table.');
    } catch (err) {
      // Column already exists, safe to ignore
    }

    // Ensure sales status enum supports Cancelled, Revised, Superseded
    try {
      await connection.query("ALTER TABLE `sales` MODIFY COLUMN `status` enum('Generated', 'Sent', 'Cancelled', 'Revised', 'Superseded') NOT NULL DEFAULT 'Generated'");
      console.log('Database auto-migration: Updated status column in sales table to support Cancelled, Revised, and Superseded.');
    } catch (err) {
      console.error('Failed to update status column in sales table:', err.message);
    }

    // 14. Migrate sales_edit_audit table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`sales_edit_audit\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`sale_id\` int(11) NOT NULL,
        \`invoice_number\` varchar(50) NOT NULL,
        \`original_sale_id\` int(11) NOT NULL,
        \`original_invoice_number\` varchar(50) NOT NULL,
        \`edited_by_user_id\` int(11) NOT NULL,
        \`edited_by_name\` varchar(100) NOT NULL,
        \`edited_by_role\` varchar(50) NOT NULL,
        \`before_details\` longtext NOT NULL,
        \`after_details\` longtext NOT NULL,
        \`reason\` text NOT NULL,
        \`edited_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        FOREIGN KEY (\`original_sale_id\`) REFERENCES \`sales\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Migrate purchase_audit_logs table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`purchase_audit_logs\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`purchase_id\` int(11) NOT NULL,
        \`invoice_number\` varchar(50) NOT NULL,
        \`action\` enum('Edit', 'Delete') NOT NULL,
        \`performed_by_user_id\` int(11) NOT NULL,
        \`performed_by_name\` varchar(100) NOT NULL,
        \`performed_by_role\` varchar(50) NOT NULL,
        \`previous_values\` longtext NOT NULL,
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure pos_edit_lock_hours exists in settings table
    try {
      const [checkLockHours] = await connection.query("SELECT id FROM settings WHERE key_name = 'pos_edit_lock_hours'");
      if (checkLockHours.length === 0) {
        await connection.query("INSERT INTO settings (key_name, value, display_name, updated_by) VALUES ('pos_edit_lock_hours', '24', 'Lock POS Edits After (Hours)', 'System')");
        console.log('Database auto-migration: Added pos_edit_lock_hours setting.');
      }
    } catch (err) {
      console.error('Failed to auto-migrate pos_edit_lock_hours setting:', err.message);
    }

    // Add database indexes for performance optimization
    const indexes = [
      { table: 'products', name: 'idx_products_name', cols: 'name(191)' },
      { table: 'products', name: 'idx_products_category', cols: 'category_id' },
      { table: 'products', name: 'idx_products_supplier', cols: 'supplier_id' },
      { table: 'sales', name: 'idx_sales_date', cols: 'sale_date' },
      { table: 'sale_items', name: 'idx_sale_items_product', cols: 'product_id' },
      { table: 'sale_items', name: 'idx_sale_items_sale', cols: 'sale_id' },
      { table: 'orders', name: 'idx_orders_date', cols: 'order_date' },
      { table: 'order_items', name: 'idx_order_items_product', cols: 'product_id' },
      { table: 'order_items', name: 'idx_order_items_order', cols: 'order_id' },
      { table: 'purchases', name: 'idx_purchases_date', cols: 'purchase_date' },
      { table: 'purchase_items', name: 'idx_purchase_items_product', cols: 'product_id' },
      { table: 'purchase_items', name: 'idx_purchase_items_purchase', cols: 'purchase_id' },
      { table: 'expenses', name: 'idx_expenses_date', cols: 'expense_date' }
    ];

    for (const idx of indexes) {
      try {
        await connection.query(`CREATE INDEX \`${idx.name}\` ON \`${idx.table}\` (${idx.cols})`);
        console.log(`Database auto-migration: Created index ${idx.name} on ${idx.table}.`);
      } catch (err) {
        // Index likely already exists, ignore error
      }
    }

    // 13. Migrate internal_consumptions table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`internal_consumptions\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`product_id\` int(11) NOT NULL,
        \`size\` varchar(50) DEFAULT NULL,
        \`quantity\` int(11) NOT NULL,
        \`purchase_price\` decimal(10,2) NOT NULL,
        \`sales_price\` decimal(10,2) NOT NULL,
        \`usage_date\` date NOT NULL,
        \`used_by\` varchar(100) NOT NULL,
        \`reason\` varchar(100) NOT NULL,
        \`notes\` text DEFAULT NULL,
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Role Management Tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`roles\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`name\` varchar(50) NOT NULL,
        \`description\` varchar(255) DEFAULT NULL,
        \`status\` enum('active','inactive') DEFAULT 'active',
        \`is_system\` tinyint(1) DEFAULT 0,
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`name\` (\`name\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`role_permissions\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`role_id\` int(11) NOT NULL,
        \`module_name\` varchar(50) NOT NULL,
        \`action_name\` varchar(50) NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`role_module_action\` (\`role_id\`, \`module_name\`, \`action_name\`),
        FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`role_audit_logs\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`user_id\` int(11) DEFAULT NULL,
        \`action\` varchar(50) NOT NULL,
        \`role_id\` int(11) DEFAULT NULL,
        \`details\` text NOT NULL,
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed Roles if empty
    const [rolesCount] = await connection.query('SELECT COUNT(*) as count FROM roles');
    if (rolesCount[0].count === 0) {
      await connection.query(`
        INSERT INTO \`roles\` (\`id\`, \`name\`, \`description\`, \`status\`, \`is_system\`) VALUES
        (1, 'Owner', 'Full access to all system modules and settings', 'active', 1),
        (2, 'Admin', 'Full administrative capabilities', 'active', 1),
        (3, 'Manager', 'Manage inventory, sales, purchases, reports, and standard modules', 'active', 1),
        (4, 'Staff', 'Standard operations access, limited modules', 'active', 1),
        (5, 'Sales', 'Access to POS terminal, invoices, e-com orders, and customers', 'active', 1),
        (6, 'Inventory Manager', 'Manage products, categories, suppliers, and purchases', 'active', 1),
        (7, 'Viewer', 'Read-only access across modules', 'active', 1)
      `);
      console.log('Database auto-migration: Seeded default roles.');
    }

    // Seed Permissions if empty
    const [permissionsCount] = await connection.query('SELECT COUNT(*) as count FROM role_permissions');
    if (permissionsCount[0].count === 0) {
      const modules = [
        'Dashboard', 'POS', 'Categories', 'Products', 'Suppliers', 'Purchases', 
        'Customers', 'Sales', 'Orders', 'Invoices', 'Reports', 'Expenses', 
        'Assets', 'Coupons', 'File Manager', 'Users', 'Settings'
      ];
      const actions = ['View', 'Create', 'Edit', 'Delete', 'Export', 'Approve', 'Restore', 'Manage Settings'];

      let insertValues = [];

      // Owner (1) & Admin (2) get full permissions
      for (const roleId of [1, 2]) {
        for (const module of modules) {
          for (const action of actions) {
            insertValues.push([roleId, module, action]);
          }
        }
      }

      // Manager (3)
      for (const module of modules) {
        if (module === 'Users' || module === 'Settings') {
          insertValues.push([3, module, 'View']);
        } else {
          for (const action of ['View', 'Create', 'Edit', 'Export', 'Approve', 'Restore']) {
            insertValues.push([3, module, action]);
          }
        }
      }

      // Staff (4)
      const staffPerms = {
        'Dashboard': ['View'],
        'POS': ['View', 'Create'],
        'Categories': ['View'],
        'Products': ['View'],
        'Suppliers': ['View'],
        'Purchases': ['View'],
        'Customers': ['View', 'Create'],
        'Sales': ['View', 'Create'],
        'Orders': ['View'],
        'Invoices': ['View'],
        'Expenses': ['View', 'Create'],
        'Assets': ['View'],
        'Coupons': ['View'],
        'File Manager': ['View']
      };
      for (const [module, acts] of Object.entries(staffPerms)) {
        for (const action of acts) {
          insertValues.push([4, module, action]);
        }
      }

      // Sales (5)
      const salesPerms = {
        'Dashboard': ['View'],
        'POS': ['View', 'Create', 'Edit'],
        'Customers': ['View', 'Create', 'Edit', 'Export'],
        'Sales': ['View', 'Create', 'Edit', 'Export'],
        'Orders': ['View', 'Create', 'Edit'],
        'Invoices': ['View', 'Create', 'Export'],
        'Coupons': ['View'],
        'Categories': ['View'],
        'Products': ['View']
      };
      for (const [module, acts] of Object.entries(salesPerms)) {
        for (const action of acts) {
          insertValues.push([5, module, action]);
        }
      }

      // Inventory Manager (6)
      const invPerms = {
        'Dashboard': ['View'],
        'Categories': ['View', 'Create', 'Edit', 'Delete'],
        'Products': ['View', 'Create', 'Edit', 'Delete', 'Export'],
        'Suppliers': ['View', 'Create', 'Edit', 'Delete', 'Export'],
        'Purchases': ['View', 'Create', 'Edit', 'Delete', 'Export', 'Approve'],
        'Customers': ['View'],
        'File Manager': ['View', 'Create', 'Edit', 'Delete']
      };
      for (const [module, acts] of Object.entries(invPerms)) {
        for (const action of acts) {
          insertValues.push([6, module, action]);
        }
      }

      // Viewer (7)
      for (const module of modules) {
        insertValues.push([7, module, 'View']);
      }

      // Bulk insert permissions
      await connection.query(
        'INSERT INTO role_permissions (role_id, module_name, action_name) VALUES ?',
        [insertValues]
      );
      console.log('Database auto-migration: Seeded default role permissions.');
    }

    // Ensure role_id column exists in admins table
    try {
      await connection.query('ALTER TABLE `admins` ADD COLUMN `role_id` int(11) DEFAULT NULL AFTER `email`');
      console.log('Database auto-migration: Added role_id column to admins table.');
    } catch (err) {
      // Column already exists, safe to ignore
    }

    try {
      await connection.query('ALTER TABLE `admins` ADD CONSTRAINT `fk_admins_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE SET NULL');
      console.log('Database auto-migration: Added foreign key constraint fk_admins_role to admins table.');
    } catch (err) {
      // Constraint already exists, safe to ignore
    }

    // Assign existing admins with null role_id to Owner role (role_id = 1)
    await connection.query('UPDATE `admins` SET `role_id` = 1 WHERE `role_id` IS NULL');
    console.log('Database auto-migration: Associated existing admin users with Owner role.');

    // Audit tracking migrations for categories, products, suppliers, purchases, customers, expenses, coupons
    const auditTables = ['categories', 'products', 'suppliers', 'purchases', 'customers', 'expenses', 'coupons'];
    for (const table of auditTables) {
      try {
        await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`created_by_user_id\` int(11) DEFAULT NULL`);
        console.log(`Database auto-migration: Added created_by_user_id column to ${table} table.`);
      } catch (err) {}
      try {
        await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`created_by_name\` varchar(100) DEFAULT NULL`);
        console.log(`Database auto-migration: Added created_by_name column to ${table} table.`);
      } catch (err) {}
      try {
        await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`created_by_role\` varchar(50) DEFAULT NULL`);
        console.log(`Database auto-migration: Added created_by_role column to ${table} table.`);
      } catch (err) {}
      try {
        await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP`);
        console.log(`Database auto-migration: Added created_at column to ${table} table.`);
      } catch (err) {}
    }

    // 15. Migrate email_logs table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`email_logs\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`recipient\` varchar(255) NOT NULL,
        \`subject\` varchar(255) NOT NULL,
        \`body\` text NOT NULL,
        \`status\` enum('Sent', 'Failed', 'Pending Retry') NOT NULL DEFAULT 'Pending Retry',
        \`error_message\` text DEFAULT NULL,
        \`attempts\` int(11) DEFAULT 0,
        \`order_number\` varchar(50) DEFAULT NULL,
        \`invoice_number\` varchar(50) DEFAULT NULL,
        \`created_at\` timestamp DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`idx_invoice_recipient\` (\`invoice_number\`, \`recipient\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('Database auto-migration: Created email_logs table.');

    console.log('Stock Management Database extension auto-migrations completed.');
  } catch (error) {
    console.error('Database extension migration failed:', error.message);
  } finally {
    if (connection) {
      connection.release();
      console.log('Database connection released back to pool.');
    }
  }
})();

module.exports = pool;
