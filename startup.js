const { initializeAzureServices } = require('./config/azure');

async function startApplication() {
  console.log('🚀 Starting O9 Action Button Generator...');
  
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
    process.exit(1);
  }
  
  // Initialize Azure services
  console.log('🔧 Initializing Azure services...');
  const azureInitialized = await initializeAzureServices();
  
  if (!azureInitialized) {
    console.error('❌ Failed to initialize Azure services');
    process.exit(1);
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
  process.exit(1);
});