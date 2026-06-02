const db = require('../config/database');

// 1. Submit a Review (Public Checkout / E-commerce customer)
exports.create = async (req, res) => {
  try {
    const { product_id, customer_name, rating, review_message } = req.body;

    if (!product_id || !customer_name || !rating || !review_message) {
      return res.status(400).json({ error: 'Product ID, customer name, rating (1-5), and review message are required' });
    }

    const ratingVal = parseInt(rating);
    if (isNaN(ratingVal) || ratingVal < 1 || ratingVal > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }

    // Check if product exists
    const [products] = await db.query('SELECT name, code FROM products WHERE id = ? LIMIT 1', [product_id]);
    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const p = products[0];

    const [result] = await db.query(
      'INSERT INTO reviews (product_id, customer_name, rating, review_message, status) VALUES (?, ?, ?, ?, "Pending")',
      [product_id, customer_name, ratingVal, review_message]
    );

    const reviewId = result.insertId;

    // Create Notification alert for new review
    await db.query(`
      INSERT INTO notifications (type, message, reference_id)
      VALUES ('review', ?, ?)
    `, [
      `New review submitted by ${customer_name} for ${p.name} (${ratingVal} stars).`,
      reviewId
    ]);

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully! It is pending administrator approval.',
      reviewId
    });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 2. Get approved reviews for a single product (Public)
exports.getProductReviews = async (req, res) => {
  try {
    const { id } = req.params; // Product ID
    const [reviews] = await db.query(
      'SELECT id, customer_name, rating, review_message, created_at FROM reviews WHERE product_id = ? AND status = "Approved" ORDER BY created_at DESC',
      [id]
    );
    res.json({ success: true, reviews });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 3. List all reviews for moderation (Admin dashboard filterable/sortable)
exports.listAll = async (req, res) => {
  try {
    const { status } = req.query;

    let sql = `
      SELECT r.*, p.name as product_name, p.code as product_code, p.image as product_image
      FROM reviews r
      JOIN products p ON r.product_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND r.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY r.created_at DESC';

    const [reviews] = await db.query(sql, params);
    res.json({ success: true, reviews });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 4. Update/Moderate Review status (Admin)
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatus = ['Pending', 'Approved', 'Rejected'];
    if (!status || !validStatus.includes(status)) {
      return res.status(400).json({ error: 'Invalid or missing status. Allowed values: Pending, Approved, Rejected' });
    }

    const [existing] = await db.query('SELECT id FROM reviews WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    await db.query('UPDATE reviews SET status = ? WHERE id = ?', [status, id]);
    res.json({ success: true, message: `Review status updated to ${status} successfully!` });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
