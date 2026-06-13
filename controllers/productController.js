const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const xlsx = require('xlsx');
const db = require('../config/database');

// Helper to slugify category names
const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

// Helper to auto-create category
const getOrCreateCategoryId = async (categoryName) => {
  const name = (categoryName || 'General').trim();
  const [categories] = await db.query('SELECT id FROM categories WHERE LOWER(name) = LOWER(?) LIMIT 1', [name]);
  
  if (categories.length > 0) {
    return categories[0].id;
  }
  
  const slug = slugify(name);
  const [result] = await db.query('INSERT INTO categories (name, slug, status) VALUES (?, ?, ?)', [name, slug, 'active']);
  return result.insertId;
};

// Helper to auto-create supplier
const getOrCreateSupplierId = async (supplierName) => {
  const name = (supplierName || '').trim();
  if (name === '') return null;

  const [suppliers] = await db.query('SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?) LIMIT 1', [name]);
  if (suppliers.length > 0) {
    return suppliers[0].id;
  }

  const [result] = await db.query(
    'INSERT INTO suppliers (name, mobile, address) VALUES (?, ?, ?)',
    [name, '0000000000', 'Imported product supplier']
  );
  return result.insertId;
};

exports.list = async (req, res) => {
  try {
    const query = req.query.q || '';
    const categoryId = parseInt(req.query.category) || 0;

    let sql = `
      SELECT p.*, c.name as category_name, s.name as supplier_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (query) {
      sql += ' AND (p.name LIKE ? OR p.code LIKE ?)';
      params.push(`%${query}%`, `%${query}%`);
    }

    if (categoryId > 0) {
      sql += ' AND p.category_id = ?';
      params.push(categoryId);
    }

    sql += ' ORDER BY p.name ASC';

    const [products] = await db.query(sql, params);

    // Fetch variants for all products
    const [variants] = await db.query('SELECT * FROM product_variants');
    const variantsByProduct = {};
    variants.forEach(v => {
      if (!variantsByProduct[v.product_id]) {
        variantsByProduct[v.product_id] = [];
      }
      variantsByProduct[v.product_id].push(v);
    });

    // Fetch colors for all products
    const [colors] = await db.query('SELECT * FROM product_colors');
    const colorsByProduct = {};
    colors.forEach(c => {
      if (!colorsByProduct[c.product_id]) {
        colorsByProduct[c.product_id] = [];
      }
      colorsByProduct[c.product_id].push(c);
    });

    // Attach variants and colors to products
    products.forEach(p => {
      p.variants = variantsByProduct[p.id] || [];
      p.colors = colorsByProduct[p.id] || [];
    });

    res.json({ success: true, products });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.get = async (req, res) => {
  try {
    const { id } = req.params;
    const [products] = await db.query('SELECT * FROM products WHERE id = ? LIMIT 1', [id]);
    
    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const [variants] = await db.query('SELECT * FROM product_variants WHERE product_id = ?', [id]);
    const [colors] = await db.query('SELECT * FROM product_colors WHERE product_id = ?', [id]);
    const product = products[0];
    product.variants = variants;
    product.colors = colors;

    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.create = async (req, res) => {
  try {
    // Transform req.files array (from upload.any()) to field mapping
    if (Array.isArray(req.files)) {
      const filesObj = {};
      req.files.forEach(file => {
        if (!filesObj[file.fieldname]) {
          filesObj[file.fieldname] = [];
        }
        filesObj[file.fieldname].push(file);
      });
      req.files = filesObj;
    }

    const {
      code, name, category_id, supplier_id, size, age,
      purchase_price, sales_price, stock_quantity, initial_stock_quantity, status, variants, colors,
      image, image_back, image_side, image_detail, thumbnail
    } = req.body;

    if (!code || !name || !category_id || !purchase_price || !sales_price) {
      return res.status(400).json({ error: 'Please enter all required fields' });
    }

    // Check duplicate code
    const [existing] = await db.query('SELECT id FROM products WHERE LOWER(code) = LOWER(?)', [code]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Product code already exists' });
    }

    // Handle image files if uploaded (via multer fields), or use file manager paths if provided in body
    const imagePath = req.files && req.files['image'] ? `uploads/products/${req.files['image'][0].filename}` : (image || null);
    const backPath = req.files && req.files['image_back'] ? `uploads/products/${req.files['image_back'][0].filename}` : (image_back || null);
    const sidePath = req.files && req.files['image_side'] ? `uploads/products/${req.files['image_side'][0].filename}` : (image_side || null);
    const detailPath = req.files && req.files['image_detail'] ? `uploads/products/${req.files['image_detail'][0].filename}` : (image_detail || null);
    const thumbnailPath = req.files && req.files['thumbnail'] ? `uploads/products/${req.files['thumbnail'][0].filename}` : (thumbnail || null);

    const actualPriceVal = req.body.actual_price ? parseFloat(req.body.actual_price) : null;
    const salesPriceVal = parseFloat(sales_price);
    let discountPercentVal = 0;
    if (actualPriceVal && actualPriceVal > salesPriceVal) {
      discountPercentVal = Math.round(((actualPriceVal - salesPriceVal) / actualPriceVal) * 100);
    }

    const initialStockQty = initial_stock_quantity !== undefined ? parseInt(initial_stock_quantity) : (parseInt(stock_quantity) || 0);

    const [result] = await db.query(
      `INSERT INTO products 
       (code, name, category_id, supplier_id, size, age, purchase_price, actual_price, sales_price, discount_percent, stock_quantity, initial_stock_quantity, image, image_back, image_side, image_detail, thumbnail, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code, name, category_id, supplier_id || null, size || null, age || null,
        purchase_price, actualPriceVal, salesPriceVal, discountPercentVal, stock_quantity || 0, initialStockQty, imagePath, backPath, sidePath, detailPath, thumbnailPath, status || 'active'
      ]
    );

    const productId = result.insertId;

    // Handle variants sizes if provided
    const variantsArr = variants ? (typeof variants === 'string' ? JSON.parse(variants) : variants) : [];
    if (Array.isArray(variantsArr)) {
      for (const variant of variantsArr) {
        if (variant.size && variant.stock_quantity !== undefined) {
          await db.query(
            'INSERT INTO product_variants (product_id, size, stock_quantity) VALUES (?, ?, ?)',
            [productId, variant.size.trim(), parseInt(variant.stock_quantity) || 0]
          );
        }
      }
    }

    // Handle color variants if provided
    const colorsArr = colors ? (typeof colors === 'string' ? JSON.parse(colors) : colors) : [];
    if (Array.isArray(colorsArr)) {
      for (let i = 0; i < colorsArr.length; i++) {
        const col = colorsArr[i];
        if (col.color_name) {
          let colorImgPath = null;
          if (req.files && req.files['color_image_' + i]) {
            colorImgPath = `uploads/products/${req.files['color_image_' + i][0].filename}`;
          } else if (col.image_path) {
            colorImgPath = col.image_path;
          }
          await db.query(
            'INSERT INTO product_colors (product_id, color_name, image_path) VALUES (?, ?, ?)',
            [productId, col.color_name.trim(), colorImgPath]
          );
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      productId
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.update = async (req, res) => {
  try {
    // Transform req.files array (from upload.any()) to field mapping
    if (Array.isArray(req.files)) {
      const filesObj = {};
      req.files.forEach(file => {
        if (!filesObj[file.fieldname]) {
          filesObj[file.fieldname] = [];
        }
        filesObj[file.fieldname].push(file);
      });
      req.files = filesObj;
    }

    const { id } = req.params;
    const {
      code, name, category_id, supplier_id, size, age,
      purchase_price, sales_price, stock_quantity, initial_stock_quantity, status, variants, colors,
      image, image_back, image_side, image_detail, thumbnail
    } = req.body;

    if (!code || !name || !category_id || !purchase_price || !sales_price) {
      return res.status(400).json({ error: 'Please enter all required fields' });
    }

    // Check product exists
    const [exists] = await db.query('SELECT id, image, image_back, image_side, image_detail, thumbnail FROM products WHERE id = ?', [id]);
    if (exists.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Check duplicate code
    const [duplicate] = await db.query('SELECT id FROM products WHERE LOWER(code) = LOWER(?) AND id != ?', [code, id]);
    if (duplicate.length > 0) {
      return res.status(400).json({ error: 'Product code already exists' });
    }

    let imagePath = exists[0].image;
    if (req.files && req.files['image']) {
      if (imagePath && imagePath.includes('uploads/products/')) {
        const oldPath = path.join(__dirname, '../', imagePath);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      imagePath = `uploads/products/${req.files['image'][0].filename}`;
    } else if (image !== undefined) {
      imagePath = image || null;
    }

    let backPath = exists[0].image_back;
    if (req.files && req.files['image_back']) {
      if (backPath && backPath.includes('uploads/products/')) {
        const oldPath = path.join(__dirname, '../', backPath);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      backPath = `uploads/products/${req.files['image_back'][0].filename}`;
    } else if (image_back !== undefined) {
      backPath = image_back || null;
    }

    let sidePath = exists[0].image_side;
    if (req.files && req.files['image_side']) {
      if (sidePath && sidePath.includes('uploads/products/')) {
        const oldPath = path.join(__dirname, '../', sidePath);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      sidePath = `uploads/products/${req.files['image_side'][0].filename}`;
    } else if (image_side !== undefined) {
      sidePath = image_side || null;
    }

    let detailPath = exists[0].image_detail;
    if (req.files && req.files['image_detail']) {
      if (detailPath && detailPath.includes('uploads/products/')) {
        const oldPath = path.join(__dirname, '../', detailPath);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      detailPath = `uploads/products/${req.files['image_detail'][0].filename}`;
    } else if (image_detail !== undefined) {
      detailPath = image_detail || null;
    }

    let thumbnailPath = exists[0].thumbnail;
    if (req.files && req.files['thumbnail']) {
      if (thumbnailPath && thumbnailPath.includes('uploads/products/')) {
        const oldPath = path.join(__dirname, '../', thumbnailPath);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      thumbnailPath = `uploads/products/${req.files['thumbnail'][0].filename}`;
    } else if (thumbnail !== undefined) {
      thumbnailPath = thumbnail || null;
    }

    const actualPriceVal = req.body.actual_price ? parseFloat(req.body.actual_price) : null;
    const salesPriceVal = parseFloat(sales_price);
    let discountPercentVal = 0;
    if (actualPriceVal && actualPriceVal > salesPriceVal) {
      discountPercentVal = Math.round(((actualPriceVal - salesPriceVal) / actualPriceVal) * 100);
    }

    let updateFields = `code = ?, name = ?, category_id = ?, supplier_id = ?, size = ?, age = ?, 
       purchase_price = ?, actual_price = ?, sales_price = ?, discount_percent = ?, stock_quantity = ?, image = ?, 
       image_back = ?, image_side = ?, image_detail = ?, thumbnail = ?, status = ?`;
    let updateParams = [
      code, name, category_id, supplier_id || null, size || null, age || null,
      purchase_price, actualPriceVal, salesPriceVal, discountPercentVal, stock_quantity || 0, imagePath, 
      backPath, sidePath, detailPath, thumbnailPath, status || 'active'
    ];

    if (initial_stock_quantity !== undefined) {
      updateFields += `, initial_stock_quantity = ?`;
      updateParams.push(parseInt(initial_stock_quantity) || 0);
    }

    updateParams.push(id);

    await db.query(
      `UPDATE products SET ${updateFields} WHERE id = ?`,
      updateParams
    );

    // Delete existing variants and re-insert new ones (simplifies updating)
    if (variants) {
      await db.query('DELETE FROM product_variants WHERE product_id = ?', [id]);
      
      const variantsArr = typeof variants === 'string' ? JSON.parse(variants) : variants;
      if (Array.isArray(variantsArr)) {
        for (const variant of variantsArr) {
          if (variant.size && variant.stock_quantity !== undefined) {
            await db.query(
              'INSERT INTO product_variants (product_id, size, stock_quantity) VALUES (?, ?, ?)',
              [id, variant.size.trim(), parseInt(variant.stock_quantity) || 0]
            );
          }
        }
      }
    }

    // Handle colors
    if (colors !== undefined) {
      const [existingColors] = await db.query('SELECT image_path FROM product_colors WHERE product_id = ?', [id]);
      await db.query('DELETE FROM product_colors WHERE product_id = ?', [id]);
      
      const colorsArr = typeof colors === 'string' ? JSON.parse(colors) : colors;
      const keptFiles = new Set();
      if (Array.isArray(colorsArr)) {
        for (let i = 0; i < colorsArr.length; i++) {
          const col = colorsArr[i];
          if (col.color_name) {
            let colorImgPath = null;
            if (req.files && req.files['color_image_' + i]) {
              colorImgPath = `uploads/products/${req.files['color_image_' + i][0].filename}`;
            } else if (col.image_path) {
              colorImgPath = col.image_path;
              keptFiles.add(colorImgPath);
            }
            await db.query(
              'INSERT INTO product_colors (product_id, color_name, image_path) VALUES (?, ?, ?)',
              [id, col.color_name.trim(), colorImgPath]
            );
          }
        }
      }

      // Unlink orphaned color files
      for (const row of existingColors) {
        if (row.image_path && !keptFiles.has(row.image_path)) {
          // Check that it's not used by any other product
          const [inUse] = await db.query('SELECT id FROM product_colors WHERE image_path = ? LIMIT 1', [row.image_path]);
          const [inProducts] = await db.query('SELECT id FROM products WHERE image = ? OR image_back = ? OR image_side = ? OR image_detail = ? OR thumbnail = ? LIMIT 1', [row.image_path, row.image_path, row.image_path, row.image_path, row.image_path]);
          if (inUse.length === 0 && inProducts.length === 0) {
            if (row.image_path.includes('uploads/products/')) {
              const oldPath = path.join(__dirname, '../', row.image_path);
              if (fs.existsSync(oldPath)) {
                fs.unlinkSync(oldPath);
              }
            }
          }
        }
      }
    }

    res.json({ success: true, message: 'Product updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if product is referenced in sale_items or purchase_items
    const [sales] = await db.query('SELECT id FROM sale_items WHERE product_id = ? LIMIT 1', [id]);
    const [purchases] = await db.query('SELECT id FROM purchase_items WHERE product_id = ? LIMIT 1', [id]);
    
    if (sales.length > 0 || purchases.length > 0) {
      return res.status(400).json({
        error: 'Cannot delete product. It is linked to active transactions (sales or purchases). You can set its status to inactive instead.'
      });
    }

    // Delete image file first
    const [product] = await db.query('SELECT image, thumbnail FROM products WHERE id = ?', [id]);
    if (product.length > 0) {
      if (product[0].image) {
        const imgPath = path.join(__dirname, '../', product[0].image);
        if (fs.existsSync(imgPath)) {
          fs.unlinkSync(imgPath);
        }
      }
      if (product[0].thumbnail) {
        const thumbPath = path.join(__dirname, '../', product[0].thumbnail);
        if (fs.existsSync(thumbPath)) {
          fs.unlinkSync(thumbPath);
        }
      }
    }

    // Delete product_colors images first
    const [colors] = await db.query('SELECT image_path FROM product_colors WHERE product_id = ?', [id]);
    for (const col of colors) {
      if (col.image_path) {
        const [inUse] = await db.query('SELECT id FROM product_colors WHERE image_path = ? AND product_id != ? LIMIT 1', [col.image_path, id]);
        const [inProducts] = await db.query('SELECT id FROM products WHERE image = ? OR image_back = ? OR image_side = ? OR image_detail = ? OR thumbnail = ? LIMIT 1', [col.image_path, col.image_path, col.image_path, col.image_path, col.image_path]);
        if (inUse.length === 0 && inProducts.length === 0) {
          if (col.image_path.includes('uploads/products/')) {
            const imgPath = path.join(__dirname, '../', col.image_path);
            if (fs.existsSync(imgPath)) {
              fs.unlinkSync(imgPath);
            }
          }
        }
      }
    }

    // Delete variants
    await db.query('DELETE FROM product_variants WHERE product_id = ?', [id]);
    
    // Delete product
    const [result] = await db.query('DELETE FROM products WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// Bulk Import Products (CSV or XLSX)
exports.import = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a CSV or XLSX file.' });
    }

    const filePath = req.file.path;
    const extension = path.extname(req.file.originalname).toLowerCase();
    
    let rows = [];

    if (extension === '.csv') {
      rows = await parseCsv(filePath);
    } else if (extension === '.xlsx' || extension === '.xls') {
      rows = parseXlsx(filePath);
    } else {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Only CSV and XLSX files are supported.' });
    }

    if (rows.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Uploaded file is empty.' });
    }

    // Validate required headers
    const requiredHeaders = [
      'product name',
      'product code',
      'purchase price',
      'initial stock quantity',
      'size'
    ];

    const firstRowHeaders = Object.keys(rows[0]).map(h => h.trim().toLowerCase());
    const missingHeaders = [];
    requiredHeaders.forEach(required => {
      if (!firstRowHeaders.includes(required)) {
        missingHeaders.push(required);
      }
    });

    if (missingHeaders.length > 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        error: 'Missing required columns in CSV/XLSX: ' + missingHeaders.map(h => `'${h}'`).join(', ')
      });
    }

    const hasCategoryHeader = firstRowHeaders.includes('category');
    const hasAgeHeader = firstRowHeaders.includes('age');
    const hasSalesPriceHeader = firstRowHeaders.includes('sales price');
    const hasSupplierHeader = firstRowHeaders.includes('supplier list');

    let successCount = 0;
    let failedCount = 0;
    const failedRows = [];

    // Pre-fetch existing products to detect inserts vs updates
    const [existingProducts] = await db.query('SELECT id, code, stock_quantity, size, category_id, supplier_id, age, sales_price FROM products');
    const existingProductsMap = {};
    existingProducts.forEach(p => {
      existingProductsMap[p.code.toLowerCase()] = p;
    });

    const getRowValue = (r, key1, key2, fallback = '') => {
      const val = r[key1] !== undefined && r[key1] !== null ? r[key1] : (r[key2] !== undefined && r[key2] !== null ? r[key2] : fallback);
      return typeof val === 'string' ? val.trim() : String(val).trim();
    };

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const rowNum = index + 2; // Line index (1-based + 1 for header)
      
      const productName = getRowValue(row, 'Product Name', 'product name');
      const productCode = getRowValue(row, 'Product Code', 'product code');
      const categoryName = getRowValue(row, 'Category', 'category', 'General');
      const supplierName = getRowValue(row, 'Supplier List', 'supplier list');
      const ageVal = getRowValue(row, 'Age', 'age');
      
      const rawPurchasePrice = row['Purchase Price'] !== undefined && row['Purchase Price'] !== null ? row['Purchase Price'] : (row['purchase price'] !== undefined && row['purchase price'] !== null ? row['purchase price'] : 0);
      const purchasePrice = parseFloat(rawPurchasePrice);

      const rawSalesPrice = row['Sales Price'] !== undefined && row['Sales Price'] !== null ? row['Sales Price'] : (row['sales price'] !== undefined && row['sales price'] !== null ? row['sales price'] : 0);
      const salesPrice = parseFloat(rawSalesPrice);

      const rawStockQty = row['Initial Stock Quantity'] !== undefined && row['Initial Stock Quantity'] !== null ? row['Initial Stock Quantity'] : (row['initial stock quantity'] !== undefined && row['initial stock quantity'] !== null ? row['initial stock quantity'] : (row['initial_stock_quantity'] !== undefined && row['initial_stock_quantity'] !== null ? row['initial_stock_quantity'] : 0));
      const stockQty = parseInt(rawStockQty);

      let size = getRowValue(row, 'Size', 'size');

      // Validation
      const errors = [];
      if (!productName) errors.push('Product name is required.');
      if (!productCode) errors.push('Product code is required.');
      if (isNaN(purchasePrice) || purchasePrice <= 0) errors.push('Valid purchase price is required.');
      if (isNaN(salesPrice) || salesPrice < 0) errors.push('Sales price must be a valid non-negative number.');

      // Smart Sizing Fallback: size empty but age not, age acts as size
      if (size === '' && ageVal !== '' && !isNaN(ageVal)) {
        size = ageVal.toString();
      }

      if (errors.length > 0) {
        failedRows.push({ row: rowNum, errors });
        failedCount++;
        continue;
      }

      try {
        const codeLower = productCode.toLowerCase();
        const existing = existingProductsMap[codeLower];

        // Resolve Category ID
        let categoryId;
        if (existing && !hasCategoryHeader) {
          categoryId = existing.category_id;
        } else {
          categoryId = await getOrCreateCategoryId(categoryName);
        }

        // Resolve Supplier ID
        let supplierId;
        if (existing && !hasSupplierHeader) {
          supplierId = existing.supplier_id;
        } else {
          supplierId = await getOrCreateSupplierId(supplierName);
        }

        // Resolve Age
        let finalAge;
        if (existing && !hasAgeHeader) {
          finalAge = existing.age;
        } else {
          finalAge = ageVal !== '' && !isNaN(ageVal) ? parseInt(ageVal) : null;
        }

        // Resolve Sales Price
        let finalSalesPrice;
        if (existing && !hasSalesPriceHeader) {
          finalSalesPrice = parseFloat(existing.sales_price);
        } else {
          finalSalesPrice = salesPrice;
        }

        if (existing) {
          // Update product and variants
          const productId = existing.id;

          if (size !== '') {
            // Check size variant
            const [variants] = await db.query(
              'SELECT id, stock_quantity FROM product_variants WHERE product_id = ? AND LOWER(size) = LOWER(?) LIMIT 1',
              [productId, size]
            );

            if (variants.length > 0) {
              const newVarStock = parseInt(variants[0].stock_quantity) + stockQty;
              await db.query('UPDATE product_variants SET stock_quantity = ? WHERE id = ?', [newVarStock, variants[0].id]);
            } else {
              await db.query(
                'INSERT INTO product_variants (product_id, size, stock_quantity) VALUES (?, ?, ?)',
                [productId, size, stockQty]
              );
            }
          }

          // Calculate accumulated total stock from all variants
          const [allVars] = await db.query('SELECT size, stock_quantity FROM product_variants WHERE product_id = ?', [productId]);
          let sizesStr = '';
          let totalStock = 0;

          if (allVars.length > 0) {
            const sizesArr = allVars.map(v => v.size).sort();
            sizesStr = sizesArr.join(', ');
            totalStock = allVars.reduce((sum, v) => sum + parseInt(v.stock_quantity), 0);
          } else {
            totalStock = parseInt(existing.stock_quantity) + stockQty;
            sizesStr = size || existing.size;
          }

          // Update main product table
          await db.query(
            `UPDATE products SET 
             name = ?, category_id = ?, supplier_id = ?, size = ?, age = ?, 
             purchase_price = ?, sales_price = ?, stock_quantity = ? 
             WHERE id = ?`,
            [productName, categoryId, supplierId, sizesStr, finalAge, purchasePrice, finalSalesPrice, totalStock, productId]
          );

          // Update cache map values
          existing.stock_quantity = totalStock;
          existing.size = sizesStr;

        } else {
          // Insert new product
          const sizeVal = size !== '' ? size : null;
          const [result] = await db.query(
            `INSERT INTO products 
             (code, name, category_id, supplier_id, size, age, purchase_price, sales_price, stock_quantity, initial_stock_quantity, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [productCode, productName, categoryId, supplierId, sizeVal, finalAge, purchasePrice, finalSalesPrice, stockQty, stockQty]
          );

          const productId = result.insertId;

          if (size !== '') {
            await db.query(
              'INSERT INTO product_variants (product_id, size, stock_quantity) VALUES (?, ?, ?)',
              [productId, size, stockQty]
            );
          }

          // Save into local check map
          existingProductsMap[codeLower] = {
            id: productId,
            code: productCode,
            stock_quantity: stockQty,
            size: sizeVal,
            category_id: categoryId,
            supplier_id: supplierId,
            age: finalAge,
            sales_price: finalSalesPrice
          };
        }

        successCount++;
      } catch (err) {
        failedRows.push({ row: rowNum, errors: ['DB Error: ' + err.message] });
        failedCount++;
      }
    }

    // Cleanup CSV/XLSX temp file
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: `Import complete. ${successCount} products imported successfully. ${failedCount} rows failed.`,
      failedRows
    });

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};

// CSV parsing helper
const parseCsv = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
};

// XLSX parsing helper
const parseXlsx = (filePath) => {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(worksheet);
};

// In-memory active viewers map: { [productId]: { [sessionId]: timestamp } }
const activeViewersMap = {};

exports.trackViewer = async (req, res) => {
  try {
    const { id } = req.params;
    const { sessionId } = req.body;

    if (!id || !sessionId) {
      return res.status(400).json({ error: 'Missing product ID or Session ID' });
    }

    const now = Date.now();
    
    // Initialize product list if not present
    if (!activeViewersMap[id]) {
      activeViewersMap[id] = {};
    }

    // Update session timestamp
    activeViewersMap[id][sessionId] = now;

    // Cleanup active viewers list: remove sessions inactive for > 30 seconds
    const threshold = now - 30000;
    const activeSessions = activeViewersMap[id];
    let realCount = 0;

    for (const [sid, timestamp] of Object.entries(activeSessions)) {
      if (timestamp < threshold) {
        delete activeSessions[sid];
      } else {
        realCount++;
      }
    }

    // Predefined baseline logic for UI demonstration + actual real-time active sessions.
    // Base is deterministic per product (5 to 19) + a slow fluctuation over time (-3 to +3) + realCount.
    const base = (parseInt(id) * 7) % 15 + 5;
    const timeSec = Math.floor(now / 15000); // changes every 15s
    const fluctuation = (timeSec * 3 + parseInt(id)) % 7 - 3;
    const count = Math.max(1, base + fluctuation + (realCount - 1));

    res.json({ success: true, count, realCount });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
