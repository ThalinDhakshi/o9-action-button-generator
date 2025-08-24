console.log('🚀 Starting O9 Action Button Generator...');

// Check if Azure initialization should be skipped
if (process.env.SKIP_AZURE_INIT === 'true') {
  console.log('⚠️ Skipping Azure services initialization (SKIP_AZURE_INIT=true)');
  require('./server');
  return;
}

// Try to initialize Azure services
const { initializeAzureServices } = require('./config/azure');

async function startApplication() {
  // Check environment variables
  const requiredEnvVars = [
    'COSMOS_ENDPOINT',
    'COSMOS_KEY',
    'COSMOS_DATABASE_NAME',
    'AZURE_STORAGE_CONNECTION_STRING',
    'AZURE_OPENAI_ENDPOINT',
    'AZURE_OPENAI_API_KEY'
  ];
  
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    
    // Start server anyway but with warning
    console.log('⚠️ Starting server without Azure services due to missing variables');
    require('./server');
    return;
  }
  
  // Initialize Azure services
  console.log('🔧 Initializing Azure services...');
  try {
    const azureInitialized = await initializeAzureServices();
    
    if (!azureInitialized) {
      console.error('❌ Failed to initialize Azure services, starting server anyway');
    } else {
      console.log('✅ Azure services initialized successfully');
    }
  } catch (error) {
    console.error('❌ Azure services initialization error:', error.message);
    console.log('⚠️ Starting server without Azure services');
  }
  
  // Start the Express server
  console.log('🌐 Starting Express server...');
  require('./server');
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 Received SIGTERM signal, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 Received SIGINT signal, shutting down gracefully...');
  process.exit(0);
});

// Start the application
startApplication().catch(error => {
  console.error('💥 Failed to start application:', error);
  console.log('🔧 Starting server in fallback mode...');
  require('./server');
});
