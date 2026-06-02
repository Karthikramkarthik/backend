const db = require('../config/database');

// 1. Get Instagram Settings (Public)
exports.getSettings = async (req, res) => {
  try {
    const [settings] = await db.query('SELECT * FROM instagram_settings LIMIT 1');
    if (settings.length === 0) {
      // Fallback in case seeding didn't run
      return res.json({
        success: true,
        settings: {
          profile_url: 'https://www.instagram.com/kids_boutique_diaries',
          is_enabled: 1,
          reels_count: 6,
          section_title: '✨ Capture The Sparkle on Instagram'
        }
      });
    }
    res.json({ success: true, settings: settings[0] });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 2. Update Instagram Settings (Admin)
exports.updateSettings = async (req, res) => {
  try {
    const { profile_url, is_enabled, reels_count, section_title } = req.body;

    if (!profile_url || !section_title) {
      return res.status(400).json({ error: 'Profile URL and Section Title are required' });
    }

    const [existing] = await db.query('SELECT id FROM instagram_settings LIMIT 1');
    
    if (existing.length === 0) {
      await db.query(
        'INSERT INTO instagram_settings (profile_url, is_enabled, reels_count, section_title) VALUES (?, ?, ?, ?)',
        [profile_url, is_enabled ? 1 : 0, parseInt(reels_count) || 6, section_title]
      );
    } else {
      await db.query(
        'UPDATE instagram_settings SET profile_url = ?, is_enabled = ?, reels_count = ?, section_title = ? WHERE id = ?',
        [profile_url, is_enabled ? 1 : 0, parseInt(reels_count) || 6, section_title, existing[0].id]
      );
    }

    res.json({ success: true, message: 'Instagram Settings updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 3. List Latest Instagram Reels based on settings count limit (Public)
exports.listReels = async (req, res) => {
  try {
    const [settings] = await db.query('SELECT is_enabled, reels_count FROM instagram_settings LIMIT 1');
    
    const isEnabled = settings.length > 0 ? settings[0].is_enabled : 1;
    const limitCount = settings.length > 0 ? settings[0].reels_count : 6;

    if (!isEnabled) {
      return res.json({ success: true, reels: [], isEnabled: false });
    }

    // Retrieve latest reels ordered by publish date up to setting limit
    const [reels] = await db.query(
      'SELECT * FROM instagram_reels ORDER BY publish_date DESC LIMIT ?',
      [limitCount]
    );

    res.json({ success: true, reels, isEnabled: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 4. List All Instagram Reels for dashboard listings (Admin)
exports.listAllReels = async (req, res) => {
  try {
    const [reels] = await db.query('SELECT * FROM instagram_reels ORDER BY publish_date DESC');
    res.json({ success: true, reels });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 5. Create Mock Instagram Reel (Admin)
exports.createReel = async (req, res) => {
  try {
    const { thumbnail_url, video_url, caption, publish_date, instagram_url } = req.body;

    if (!thumbnail_url || !video_url || !caption) {
      return res.status(400).json({ error: 'Thumbnail URL, Video URL, and Caption are required' });
    }

    const [result] = await db.query(
      'INSERT INTO instagram_reels (thumbnail_url, video_url, caption, publish_date, instagram_url) VALUES (?, ?, ?, ?, ?)',
      [
        thumbnail_url,
        video_url,
        caption,
        publish_date || new Date(),
        instagram_url || 'https://www.instagram.com/'
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Instagram Reel created successfully',
      reelId: result.insertId
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// 6. Delete Instagram Reel (Admin)
exports.deleteReel = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query('SELECT id FROM instagram_reels WHERE id = ? LIMIT 1', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Instagram Reel not found' });
    }

    await db.query('DELETE FROM instagram_reels WHERE id = ?', [id]);
    res.json({ success: true, message: 'Instagram Reel deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
