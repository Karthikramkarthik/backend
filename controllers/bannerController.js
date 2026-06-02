const db = require('../config/database');
const fs = require('fs');
const path = require('path');

// Helper to delete an image file safely
const deleteImage = (imagePath) => {
  if (imagePath) {
    const fullPath = path.join(__dirname, '..', imagePath);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch (err) {
        console.error('Failed to delete image file:', err.message);
      }
    }
  }
};

// 1. List all active banners ordered by display_order (Public Slider/Headers)
exports.listActive = async (req, res) => {
  try {
    const [banners] = await db.query(
      "SELECT * FROM banners WHERE status = 'active' ORDER BY display_order ASC, created_at DESC"
    );
    res.json({ success: true, banners });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 2. List all banners for Admin dashboard CRUD (Admin)
exports.listAll = async (req, res) => {
  try {
    const [banners] = await db.query('SELECT * FROM banners ORDER BY display_order ASC, created_at DESC');
    res.json({ success: true, banners });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 3. Get single banner
exports.get = async (req, res) => {
  try {
    const { id } = req.params;
    const [banners] = await db.query('SELECT * FROM banners WHERE id = ? LIMIT 1', [id]);
    if (banners.length === 0) {
      return res.status(404).json({ error: 'Banner not found' });
    }
    res.json({ success: true, banner: banners[0] });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 4. Create Banner (Admin)
exports.create = async (req, res) => {
  try {
    const { title, subtitle, redirect_url, display_order, status } = req.body;

    if (!title) {
      // Clean up uploaded file if validation fails
      if (req.file) {
        deleteImage(`uploads/banners/${req.file.filename}`);
      }
      return res.status(400).json({ error: 'Banner title is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Banner image file is required' });
    }

    const imagePath = `uploads/banners/${req.file.filename}`;

    const [result] = await db.query(
      'INSERT INTO banners (title, subtitle, image, redirect_url, display_order, status) VALUES (?, ?, ?, ?, ?, ?)',
      [title, subtitle || null, imagePath, redirect_url || null, display_order || 0, status || 'active']
    );

    res.status(201).json({
      success: true,
      message: 'Banner created successfully',
      bannerId: result.insertId,
      image: imagePath
    });

  } catch (error) {
    if (req.file) {
      deleteImage(`uploads/banners/${req.file.filename}`);
    }
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 5. Update Banner (Admin)
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subtitle, redirect_url, display_order, status } = req.body;

    if (!title) {
      if (req.file) {
        deleteImage(`uploads/banners/${req.file.filename}`);
      }
      return res.status(400).json({ error: 'Banner title is required' });
    }

    const [existing] = await db.query('SELECT * FROM banners WHERE id = ? LIMIT 1', [id]);
    if (existing.length === 0) {
      if (req.file) {
        deleteImage(`uploads/banners/${req.file.filename}`);
      }
      return res.status(404).json({ error: 'Banner not found' });
    }

    let imagePath = existing[0].image;
    if (req.file) {
      // Delete old banner image file
      deleteImage(existing[0].image);
      imagePath = `uploads/banners/${req.file.filename}`;
    }

    await db.query(
      'UPDATE banners SET title = ?, subtitle = ?, image = ?, redirect_url = ?, display_order = ?, status = ? WHERE id = ?',
      [title, subtitle || null, imagePath, redirect_url || null, display_order || 0, status || 'active', id]
    );

    res.json({
      success: true,
      message: 'Banner updated successfully',
      image: imagePath
    });

  } catch (error) {
    if (req.file) {
      deleteImage(`uploads/banners/${req.file.filename}`);
    }
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 6. Delete Banner (Admin)
exports.delete = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query('SELECT image FROM banners WHERE id = ? LIMIT 1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Banner not found' });
    }

    // Delete image file from disk
    deleteImage(existing[0].image);

    await db.query('DELETE FROM banners WHERE id = ?', [id]);
    res.json({ success: true, message: 'Banner deleted successfully' });

  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
