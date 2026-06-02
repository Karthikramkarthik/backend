const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { UPLOADS_BASE } = require('../middleware/upload');

// Fetch folders and files in a folder
exports.list = async (req, res) => {
  try {
    const { folder_id } = req.query;

    const [folders] = await db.query('SELECT * FROM folders ORDER BY name ASC');
    
    let files = [];
    let activeFolder = null;

    if (folder_id) {
      const [folderRows] = await db.query('SELECT * FROM folders WHERE id = ? LIMIT 1', [folder_id]);
      if (folderRows.length > 0) {
        activeFolder = folderRows[0];
        [files] = await db.query('SELECT *, DATE_FORMAT(uploaded_at, "%Y-%m-%d %H:%i:%s") as uploaded_at FROM files WHERE folder_id = ? ORDER BY uploaded_at DESC', [folder_id]);
      }
    } else {
      [files] = await db.query('SELECT *, DATE_FORMAT(uploaded_at, "%Y-%m-%d %H:%i:%s") as uploaded_at FROM files ORDER BY uploaded_at DESC');
    }

    res.json({
      success: true,
      folders,
      activeFolder,
      files
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.createFolder = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    const sanitizedName = name.trim();
    
    // Check duplication
    const [existing] = await db.query('SELECT id FROM folders WHERE LOWER(name) = LOWER(?)', [sanitizedName]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Folder name already exists' });
    }

    const [result] = await db.query('INSERT INTO folders (name) VALUES (?)', [sanitizedName]);
    
    // Create physical folder on disk
    const diskPath = path.join(UPLOADS_BASE, 'file_manager', sanitizedName.replace(/[^a-zA-Z0-9_-]/g, '_'));
    if (!fs.existsSync(diskPath)) {
      fs.mkdirSync(diskPath, { recursive: true });
    }

    res.status(201).json({
      success: true,
      message: 'Folder created successfully!',
      folderId: result.insertId
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.renameFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const { newName } = req.body;

    if (!newName) {
      return res.status(400).json({ error: 'New folder name is required' });
    }

    const sanitizedNewName = newName.trim();

    // Check if original folder exists
    const [original] = await db.query('SELECT * FROM folders WHERE id = ? LIMIT 1', [id]);
    if (original.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Check duplicate name
    const [duplicate] = await db.query('SELECT id FROM folders WHERE LOWER(name) = LOWER(?) AND id != ?', [sanitizedNewName, id]);
    if (duplicate.length > 0) {
      return res.status(400).json({ error: 'Folder name already exists' });
    }

    const oldDiskName = original[0].name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const newDiskName = sanitizedNewName.replace(/[^a-zA-Z0-9_-]/g, '_');

    const oldDiskPath = path.join(UPLOADS_BASE, 'file_manager', oldDiskName);
    const newDiskPath = path.join(UPLOADS_BASE, 'file_manager', newDiskName);

    // Rename on disk
    if (fs.existsSync(oldDiskPath)) {
      fs.renameSync(oldDiskPath, newDiskPath);
    } else {
      fs.mkdirSync(newDiskPath, { recursive: true });
    }

    // Update database for folder name
    await db.query('UPDATE folders SET name = ? WHERE id = ?', [sanitizedNewName, id]);

    // Update db file_paths for files inside folder
    const [files] = await db.query('SELECT id, file_path FROM files WHERE folder_id = ?', [id]);
    for (const f of files) {
      const updatedPath = f.file_path.replace(`file_manager/${oldDiskName}/`, `file_manager/${newDiskName}/`);
      await db.query('UPDATE files SET file_path = ? WHERE id = ?', [updatedPath, f.id]);
    }

    res.json({ success: true, message: 'Folder renamed successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.uploadFiles = async (req, res) => {
  try {
    const { folder_id, folder_name } = req.body;

    if (!folder_id || !req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Folder ID and files are required' });
    }

    const diskFolderName = folder_name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dbResults = [];

    for (const file of req.files) {
      const relativeDbPath = `uploads/file_manager/${diskFolderName}/${file.filename}`;
      const fileSize = file.size;
      const originalName = file.originalname;

      const [result] = await db.query(
        'INSERT INTO files (folder_id, file_name, file_path, file_size) VALUES (?, ?, ?, ?)',
        [folder_id, originalName, relativeDbPath, fileSize]
      );
      dbResults.push({ id: result.insertId, name: originalName });
    }

    res.json({
      success: true,
      message: `Successfully uploaded ${req.files.length} file(s).`,
      files: dbResults
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.deleteFile = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if file exists
    const [files] = await db.query('SELECT * FROM files WHERE id = ? LIMIT 1', [id]);
    if (files.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = files[0];
    const diskPath = path.join(__dirname, '../', file.file_path);

    // Unlink on disk
    if (fs.existsSync(diskPath)) {
      fs.unlinkSync(diskPath);
    }

    // Delete in DB
    await db.query('DELETE FROM files WHERE id = ?', [id]);

    res.json({ success: true, message: 'File deleted successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.bulkDeleteFiles = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'File IDs array is required' });
    }

    // Fetch paths of all target files
    const [files] = await db.query('SELECT * FROM files WHERE id IN (?)', [ids]);
    
    // Delete files from disk
    files.forEach(file => {
      const diskPath = path.join(__dirname, '../', file.file_path);
      if (fs.existsSync(diskPath)) {
        fs.unlinkSync(diskPath);
      }
    });

    // Delete files in DB
    await db.query('DELETE FROM files WHERE id IN (?)', [ids]);

    res.json({ success: true, message: `Successfully deleted ${files.length} file(s).` });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.deleteFolder = async (req, res) => {
  try {
    const { id } = req.params;

    const [folders] = await db.query('SELECT * FROM folders WHERE id = ? LIMIT 1', [id]);
    if (folders.length === 0) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const diskFolderName = folders[0].name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const folderDiskPath = path.join(UPLOADS_BASE, 'file_manager', diskFolderName);

    // Delete folder files on disk and db
    const [files] = await db.query('SELECT file_path FROM files WHERE folder_id = ?', [id]);
    files.forEach(f => {
      const diskPath = path.join(__dirname, '../', f.file_path);
      if (fs.existsSync(diskPath)) {
        fs.unlinkSync(diskPath);
      }
    });

    // Remove folder folder on disk
    if (fs.existsSync(folderDiskPath)) {
      fs.rmSync(folderDiskPath, { recursive: true, force: true });
    }

    // Cascades files in DB automatically due to CASCADE triggers on folder_id
    await db.query('DELETE FROM folders WHERE id = ?', [id]);

    res.json({ success: true, message: 'Folder and all its contents deleted successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
