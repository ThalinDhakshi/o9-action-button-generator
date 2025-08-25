const express = require('express');
const router = express.Router();

// Minimal test endpoint to get the app running
router.post('/', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Basic endpoint working',
      timestamp: new Date().toISOString(),
      receivedData: req.body
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message 
    });
  }
});

router.get('/', async (req, res) => {
  res.json({
    message: 'Code generation endpoint is alive',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
