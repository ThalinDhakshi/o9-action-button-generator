const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { containerClient } = require('../config/azure');

const router = express.Router();

// Configure multer for temporary file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (process.env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024 // Default 10MB
  },
  fileFilter: (req, file, cb) => {
    // Allow all file types for general file management
    cb(null, true);
  }
});

// Upload general files
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { category = 'general', description = '' } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileId = uuidv4();
    const fileExtension = path.extname(req.file.originalname);
    const fileName = `${category}/${fileId}-${req.file.originalname}`;
    
    // Upload to Azure Blob Storage
    const blockBlobClient = containerClient.getBlockBlobClient(fileName);
    await blockBlobClient.uploadData(req.file.buffer, {
      blobHTTPHeaders: { 
        blobContentType: req.file.mimetype,
        blobContentDisposition: `attachment; filename="${req.file.originalname}"`
      },
      metadata: {
        category,
        description,
        uploadedAt: new Date().toISOString()
      }
    });

    const fileInfo = {
      id: fileId,
      originalName: req.file.originalname,
      fileName,
      category,
      description,
      size: req.file.size,
      mimetype: req.file.mimetype,
      extension: fileExtension,
      url: blockBlobClient.url,
      uploadedAt: new Date().toISOString()
    };

    res.json({
      message: 'File uploaded successfully',
      file: fileInfo
    });

  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List all files
router.get('/', async (req, res) => {
  try {
    const { category, limit = 100 } = req.query;
    const files = [];
    
    let prefix = category ? `${category}/` : '';
    
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      // Get blob properties and metadata
      const blobClient = containerClient.getBlobClient(blob.name);
      const properties = await blobClient.getProperties();
      
      const fileInfo = {
        name: blob.name,
        originalName: blob.name.split('-').slice(1).join('-'), // Remove UUID prefix
        size: blob.properties.contentLength,
        lastModified: blob.properties.lastModified,
        contentType: blob.properties.contentType,
        category: blob.name.split('/')[0],
        url: blobClient.url,
        metadata: properties.metadata || {}
      };
      
      files.push(fileInfo);
      
      if (files.length >= parseInt(limit)) break;
    }

    // Sort by last modified (newest first)
    files.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

    res.json(files);

  } catch (error) {
    console.error('List files error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download specific file
router.get('/:fileName/download', async (req, res) => {
  try {
    const { fileName } = req.params;
    
    // Decode the file name in case it's URL encoded
    const decodedFileName = decodeURIComponent(fileName);
    
    const blockBlobClient = containerClient.getBlockBlobClient(decodedFileName);
    
    // Check if blob exists
    const exists = await blockBlobClient.exists();
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Get blob properties for content type
    const properties = await blockBlobClient.getProperties();
    
    // Download the blob
    const downloadResponse = await blockBlobClient.download();
    
    // Set appropriate headers
    const originalName = decodedFileName.split('-').slice(1).join('-'); // Remove UUID prefix
    res.set({
      'Content-Type': properties.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${originalName}"`
    });

    // Pipe the blob stream to response
    downloadResponse.readableStreamBody.pipe(res);

  } catch (error) {
    console.error('File download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get file content as text (for preview)
router.get('/:fileName/content', async (req, res) => {
  try {
    const { fileName } = req.params;
    
    const decodedFileName = decodeURIComponent(fileName);
    const blockBlobClient = containerClient.getBlockBlobClient(decodedFileName);
    
    // Check if blob exists
    const exists = await blockBlobClient.exists();
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Get blob properties
    const properties = await blockBlobClient.getProperties();
    
    // Only allow text-based files for content preview
    const textTypes = [
      'text/',
      'application/javascript',
      'application/json',
      'application/xml'
    ];
    
    const isTextFile = textTypes.some(type => 
      (properties.contentType || '').toLowerCase().startsWith(type)
    );
    
    if (!isTextFile) {
      return res.status(400).json({ error: 'File is not a text-based file' });
    }

    // Download and convert to text
    const downloadResponse = await blockBlobClient.download();
    const chunks = [];
    
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(chunk);
    }
    
    const content = Buffer.concat(chunks).toString('utf-8');

    res.json({
      fileName: decodedFileName,
      contentType: properties.contentType,
      size: properties.contentLength,
      content: content,
      lastModified: properties.lastModified
    });

  } catch (error) {
    console.error('File content error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete file
router.delete('/:fileName', async (req, res) => {
  try {
    const { fileName } = req.params;
    
    const decodedFileName = decodeURIComponent(fileName);
    const blockBlobClient = containerClient.getBlockBlobClient(decodedFileName);
    
    // Check if blob exists
    const exists = await blockBlobClient.exists();
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Delete the blob
    await blockBlobClient.delete();

    res.json({ 
      message: 'File deleted successfully',
      fileName: decodedFileName 
    });

  } catch (error) {
    console.error('File delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get file categories and statistics
router.get('/stats/categories', async (req, res) => {
  try {
    const categories = {};
    let totalSize = 0;
    let totalFiles = 0;

    for await (const blob of containerClient.listBlobsFlat()) {
      const category = blob.name.split('/')[0];
      
      if (!categories[category]) {
        categories[category] = {
          count: 0,
          totalSize: 0,
          files: []
        };
      }

      categories[category].count++;
      categories[category].totalSize += blob.properties.contentLength || 0;
      categories[category].files.push({
        name: blob.name,
        size: blob.properties.contentLength || 0,
        lastModified: blob.properties.lastModified
      });

      totalSize += blob.properties.contentLength || 0;
      totalFiles++;
    }

    res.json({
      totalFiles,
      totalSize,
      categories: Object.keys(categories).map(name => ({
        name,
        ...categories[name]
      }))
    });

  } catch (error) {
    console.error('Get file stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk upload files
router.post('/bulk-upload', upload.array('files', 20), async (req, res) => {
  try {
    const { category = 'bulk', description = '' } = req.body;
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadResults = [];
    const errors = [];

    for (const file of req.files) {
      try {
        const fileId = uuidv4();
        const fileName = `${category}/${fileId}-${file.originalname}`;
        
        const blockBlobClient = containerClient.getBlockBlobClient(fileName);
        await blockBlobClient.uploadData(file.buffer, {
          blobHTTPHeaders: { 
            blobContentType: file.mimetype,
            blobContentDisposition: `attachment; filename="${file.originalname}"`
          },
          metadata: {
            category,
            description,
            uploadedAt: new Date().toISOString()
          }
        });

        uploadResults.push({
          id: fileId,
          originalName: file.originalname,
          fileName,
          size: file.size,
          url: blockBlobClient.url
        });

      } catch (fileError) {
        errors.push({
          fileName: file.originalname,
          error: fileError.message
        });
      }
    }

    res.json({
      message: `Bulk upload completed: ${uploadResults.length} successful, ${errors.length} failed`,
      successful: uploadResults,
      failed: errors
    });

  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;