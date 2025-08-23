console.log('🚀 Starting O9 Action Button Generator (Simplified)...');

// Skip Azure initialization for now
console.log('⚠️  Skipping Azure services initialization for testing...');

// Start the Express server directly
console.log('🌐 Starting Express server...');
require('./server');

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 Received SIGTERM signal, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📴 Received SIGINT signal, shutting down gracefully...');
  process.exit(0);
});

console.log('✅ Simplified startup completed!');
