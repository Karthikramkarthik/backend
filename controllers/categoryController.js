const db = require('../config/database');
const { cleanAuditInfo } = require('../middleware/audit');

const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start
    .replace(/-+$/, '');            // Trim - from end
};

exports.list = async (req, res) => {
  try {
    const [categories] = await db.query('SELECT * FROM categories ORDER BY name ASC');
    res.json({ success: true, categories: cleanAuditInfo(req, categories) });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.get = async (req, res) => {
  try {
    const { id } = req.params;
    const [categories] = await db.query('SELECT * FROM categories WHERE id = ? LIMIT 1', [id]);
    if (categories.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ success: true, category: cleanAuditInfo(req, categories[0]) });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, details, status } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const slug = slugify(name);
    
    // Check duplicate name
    const [existing] = await db.query('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)', [name]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Category name already exists' });
    }

    const [result] = await db.query(
      'INSERT INTO categories (name, slug, details, status, created_by_user_id, created_by_name, created_by_role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        name,
        slug,
        details || null,
        status || 'active',
        req.user ? req.user.id : null,
        req.user ? req.user.username : null,
        req.user ? req.user.role : null
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      categoryId: result.insertId
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, details, status } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    // Check if category exists
    const [exists] = await db.query('SELECT id FROM categories WHERE id = ?', [id]);
    if (exists.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check duplicate name for other categories
    const [duplicate] = await db.query(
      'SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND id != ?',
      [name, id]
    );
    if (duplicate.length > 0) {
      return res.status(400).json({ error: 'Category name already exists' });
    }

    const slug = slugify(name);

    await db.query(
      'UPDATE categories SET name = ?, slug = ?, details = ?, status = ? WHERE id = ?',
      [name, slug, details || null, status || 'active', id]
    );

    res.json({ success: true, message: 'Category updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if category has dependent products
    const [products] = await db.query('SELECT id FROM products WHERE category_id = ? LIMIT 1', [id]);
    if (products.length > 0) {
      return res.status(400).json({
        error: 'Cannot delete category. It is linked to active products. Please reassign those products first.'
      });
    }

    const [result] = await db.query('DELETE FROM categories WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
