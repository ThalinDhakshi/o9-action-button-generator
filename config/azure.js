const { CosmosClient } = require('@azure/cosmos');
const { BlobServiceClient } = require('@azure/storage-blob');
const axios = require('axios');

// Cosmos DB Client
const cosmosClient = new CosmosClient({
  endpoint: process.env.COSMOS_ENDPOINT,
  key: process.env.COSMOS_KEY
});

const database = cosmosClient.database(process.env.COSMOS_DATABASE_NAME);

// Containers
const containers = {
  knowledgeBase: database.container('knowledgeBase'),
  fieldBindings: database.container('fieldBindings'),
  generatedCode: database.container('generatedCode'),
  examples: database.container('examples')
};

// Blob Storage Client
const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);

const containerClient = blobServiceClient.getContainerClient(
  process.env.AZURE_STORAGE_CONTAINER_NAME
);

// Azure OpenAI Client
class AzureOpenAIClient {
  constructor() {
    this.endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    this.apiKey = process.env.AZURE_OPENAI_API_KEY;
    this.apiVersion = process.env.AZURE_OPENAI_API_VERSION;
    this.deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
  }

  async generateCompletion(messages, maxTokens = 5000) {
    const url = `${this.endpoint}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;
    
    const headers = {
      'Content-Type': 'application/json',
      'api-key': this.apiKey
    };

    const data = {
      messages,
      max_completion_tokens: maxTokens,
      frequency_penalty: 0,
      presence_penalty: 0
    };

    try {
      const response = await axios.post(url, data, { headers });
      return response.data;
    } catch (error) {
      console.error('Azure OpenAI API error:', error.response?.data || error.message);
      throw new Error(`AI generation failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  async generateEmbedding(text) {
    // For RAG similarity search - implement if needed
    // This would use text-embedding-ada-002 model
    const url = `${this.endpoint}/openai/deployments/text-embedding-ada-002/embeddings?api-version=${this.apiVersion}`;
    
    const headers = {
      'Content-Type': 'application/json',
      'api-key': this.apiKey
    };

    const data = {
      input: text
    };

    try {
      const response = await axios.post(url, data, { headers });
      return response.data.data[0].embedding;
    } catch (error) {
      console.error('Azure OpenAI Embedding error:', error.response?.data || error.message);
      throw new Error(`Embedding generation failed: ${error.message}`);
    }
  }
}

// Initialize Azure services
async function initializeAzureServices() {
  try {
    // Create database if it doesn't exist
    const { database: dbResponse } = await cosmosClient.databases.createIfNotExists({
      id: process.env.COSMOS_DATABASE_NAME
    });

    // Create containers if they don't exist
    const containerConfigs = [
      { id: 'knowledgeBase', partitionKey: '/type' },
      { id: 'fieldBindings', partitionKey: '/actionButtonType' },
      { id: 'generatedCode', partitionKey: '/projectId' },
      { id: 'examples', partitionKey: '/category' }
    ];

    for (const config of containerConfigs) {
      await dbResponse.containers.createIfNotExists({
        id: config.id,
        partitionKey: { paths: [config.partitionKey] }
      });
    }

    // Create blob container if it doesn't exist
    await containerClient.createIfNotExists({
      access: 'blob'
    });

    console.log('✅ Azure services initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Azure services:', error);
    return false;
  }
}

module.exports = {
  cosmosClient,
  containers,
  blobServiceClient,
  containerClient,
  AzureOpenAIClient,
  initializeAzureServices

};


