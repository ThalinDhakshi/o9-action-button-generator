const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { containers, containerClient } = require('../config/azure');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (process.env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024 // Default 10MB
  },
  fileFilter: (req, file, cb) => {
    // Allow JavaScript files, images, and markdown files
    const allowedTypes = [
      'application/javascript',
      'text/javascript',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'text/markdown',
      'text/plain',
      'application/pdf'
    ];
    
    if (allowedTypes.includes(file.mimetype) || file.originalname.endsWith('.js') || file.originalname.endsWith('.md')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JS, images, markdown, and PDF files are allowed.'));
    }
  }
});

// Upload knowledge base files (JS examples, images, documentation)
router.post('/upload', upload.array('files', 10), async (req, res) => {
  try {
    const { category, actionButtonType, description } = req.body;
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadResults = [];

    for (const file of req.files) {
      const fileId = uuidv4();
      const fileName = `${category}/${fileId}-${file.originalname}`;
      
      // Upload to Azure Blob Storage
      const blockBlobClient = containerClient.getBlockBlobClient(fileName);
      await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: { blobContentType: file.mimetype }
      });

      // Store metadata in Cosmos DB
      const knowledgeItem = {
        id: fileId,
        type: 'knowledge',
        category: category,
        actionButtonType: actionButtonType,
        fileName: file.originalname,
        filePath: fileName,
        fileType: file.mimetype,
        fileSize: file.size,
        description: description,
        uploadedAt: new Date().toISOString(),
        blobUrl: blockBlobClient.url
      };

      const { resource } = await containers.knowledgeBase.items.create(knowledgeItem);
      uploadResults.push(resource);
    }

    res.json({
      message: 'Files uploaded successfully',
      files: uploadResults
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all knowledge base items
router.get('/', async (req, res) => {
  try {
    const { category, actionButtonType } = req.query;
    
    let query = 'SELECT * FROM c WHERE c.type = "knowledge"';
    const parameters = [];

    if (category) {
      query += ' AND c.category = @category';
      parameters.push({ name: '@category', value: category });
    }

    if (actionButtonType) {
      query += ' AND c.actionButtonType = @actionButtonType';
      parameters.push({ name: '@actionButtonType', value: actionButtonType });
    }

    query += ' ORDER BY c.uploadedAt DESC';

    const { resources } = await containers.knowledgeBase.items.query({
      query,
      parameters
    }).fetchAll();

    res.json(resources);

  } catch (error) {
    console.error('Fetch knowledge error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get specific knowledge item
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { resource } = await containers.knowledgeBase.item(id, 'knowledge').read();
    
    if (!resource) {
      return res.status(404).json({ error: 'Knowledge item not found' });
    }

    res.json(resource);

  } catch (error) {
    console.error('Fetch knowledge item error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download file content
router.get('/:id/content', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get metadata from Cosmos DB
    const { resource } = await containers.knowledgeBase.item(id, 'knowledge').read();
    
    if (!resource) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Download from Blob Storage
    const blockBlobClient = containerClient.getBlockBlobClient(resource.filePath);
    const downloadResponse = await blockBlobClient.download();
    
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks);

    // Set appropriate headers
    res.set({
      'Content-Type': resource.fileType,
      'Content-Disposition': `attachment; filename="${resource.fileName}"`
    });

    res.send(content);

  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Search knowledge base
router.post('/search', async (req, res) => {
  try {
    const { searchQuery, category, actionButtonType } = req.body;
    
    let query = 'SELECT * FROM c WHERE c.type = "knowledge"';
    const parameters = [];

    if (searchQuery) {
      query += ' AND (CONTAINS(LOWER(c.fileName), LOWER(@searchQuery)) OR CONTAINS(LOWER(c.description), LOWER(@searchQuery)))';
      parameters.push({ name: '@searchQuery', value: searchQuery });
    }

    if (category) {
      query += ' AND c.category = @category';
      parameters.push({ name: '@category', value: category });
    }

    if (actionButtonType) {
      query += ' AND c.actionButtonType = @actionButtonType';
      parameters.push({ name: '@actionButtonType', value: actionButtonType });
    }

    query += ' ORDER BY c.uploadedAt DESC';

    const { resources } = await containers.knowledgeBase.items.query({
      query,
      parameters
    }).fetchAll();

    res.json(resources);

  } catch (error) {
    console.error('Search knowledge error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete knowledge item
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get metadata first
    const { resource } = await containers.knowledgeBase.item(id, 'knowledge').read();
    
    if (!resource) {
      return res.status(404).json({ error: 'Knowledge item not found' });
    }

    // Delete from Blob Storage
    const blockBlobClient = containerClient.getBlockBlobClient(resource.filePath);
    await blockBlobClient.deleteIfExists();

    // Delete from Cosmos DB
    await containers.knowledgeBase.item(id, 'knowledge').delete();

    res.json({ message: 'Knowledge item deleted successfully' });

  } catch (error) {
    console.error('Delete knowledge error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get knowledge base statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const query = `
      SELECT 
        c.category,
        c.actionButtonType,
        COUNT(1) as count,
        SUM(c.fileSize) as totalSize
      FROM c 
      WHERE c.type = "knowledge"
      GROUP BY c.category, c.actionButtonType
    `;

    const { resources } = await containers.knowledgeBase.items.query(query).fetchAll();

    const stats = {
      totalFiles: resources.reduce((sum, item) => sum + item.count, 0),
      totalSize: resources.reduce((sum, item) => sum + item.totalSize, 0),
      categories: resources
    };

    res.json(stats);

  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;