const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure main uploads directory
const UPLOADS_BASE = path.join(__dirname, '../uploads');

// Ensure base directories exist
if (!fs.existsSync(UPLOADS_BASE)) {
  fs.mkdirSync(UPLOADS_BASE, { recursive: true });
}

// Storage engine config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let uploadPath = UPLOADS_BASE;
    
    // Check if dynamic folder_name exists in body (for File Manager upload)
    if (req.body.folder_name) {
      const sanitizedFolder = req.body.folder_name.replace(/[^a-zA-Z0-9_-]/g, '_');
      uploadPath = path.join(UPLOADS_BASE, 'file_manager', sanitizedFolder);
    } else if (req.baseUrl.includes('product') || req.path.includes('product')) {
      uploadPath = path.join(UPLOADS_BASE, 'products');
    } else if (req.baseUrl.includes('purchase') || req.path.includes('purchase')) {
      uploadPath = path.join(UPLOADS_BASE, 'purchases');
    } else if (req.baseUrl.includes('banner') || req.path.includes('banner')) {
      uploadPath = path.join(UPLOADS_BASE, 'banners');
    }

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '_' + Math.round(Math.random() * 1E9);
    const cleanExt = path.extname(file.originalname).toLowerCase();
    const cleanName = path.basename(file.originalname, cleanExt).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${uniqueSuffix}_${cleanName}${cleanExt}`);
  }
});

// File filter (optional)
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.png', '.jpg', '.jpeg', '.gif', '.csv', '.xlsx', '.xls', '.pdf'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type! Allowed formats: images, CSV, Excel.'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

module.exports = upload;
module.exports.UPLOADS_BASE = UPLOADS_BASE;
