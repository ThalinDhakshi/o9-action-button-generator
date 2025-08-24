require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');

// Import route modules
const knowledgeRoutes = require('./routes/knowledge');
const fieldBindingRoutes = require('./routes/fieldBindings');
const codeGenerationRoutes = require('./routes/codeGeneration');
const filesRoutes = require('./routes/files');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// API Routes
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/field-bindings', fieldBindingRoutes);
app.use('/api/generate-code', codeGenerationRoutes);
app.use('/api/files', filesRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all handler for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 O9 Action Button Generator running on port ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔗 API: http://localhost:${PORT}/api`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health`);
});
