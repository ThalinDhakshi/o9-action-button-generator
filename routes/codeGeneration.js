const express = require('express');
const { CosmosClient } = require('@azure/cosmos');
const { AzureOpenAI } = require('openai');

const router = express.Router();

// Initialize clients directly - keep it simple
const cosmosClient = new CosmosClient({
    endpoint: process.env.COSMOS_ENDPOINT,
    key: process.env.COSMOS_KEY
});

const database = cosmosClient.database('O9ActionButtonDB');
const fieldBindingsContainer = database.container('FieldBindings');
const generatedCodeContainer = database.container('GeneratedCode');

const openai = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT_NAME
});

// Simple POST endpoint - just the basics
router.post('/', async (req, res) => {
  try {
    const { projectName, actionButtonType, businessLogic, fieldBindingId } = req.body;

    // Basic validation
    if (!projectName || !actionButtonType || !businessLogic || !fieldBindingId) {
      return res.status(400).json({ 
        error: 'Missing required fields' 
      });
    }

    // Get field binding - simple approach
    let fieldBinding;
    try {
      const { resource } = await fieldBindingsContainer.item(fieldBindingId, actionButtonType).read();
      fieldBinding = resource;
    } catch (error) {
      // Fallback query
      const query = {
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: fieldBindingId }]
      };
      const { resources } = await fieldBindingsContainer.items.query(query).fetchAll();
      fieldBinding = resources.length > 0 ? resources[0] : null;
    }
    
    if (!fieldBinding) {
      return res.status(404).json({ error: 'Field binding not found' });
    }

    // Simple AI prompt - no complex RAG for now
    const prompt = `Generate a basic JavaScript function for an O9 Planning action button:

Project: ${projectName}
Type: ${actionButtonType}
Logic: ${businessLogic}

Field Bindings: ${JSON.stringify(fieldBinding.fields, null, 2)}

Create a simple JavaScript function that implements this logic.`;

    // Call AI
    const completion = await openai.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
      messages: [
        {
          role: 'system',
          content: 'You are a JavaScript developer. Generate clean, simple code.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 1500,
      temperature: 0.3
    });

    const generatedCode = completion.choices[0].message.content;

    // Save to database - simple version
    const codeRecord = {
      id: `code_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      projectName,
      actionButtonType,
      businessLogic,
      fieldBindingId,
      generatedCode,
      createdAt: new Date().toISOString()
    };

    await generatedCodeContainer.items.create(codeRecord);

    // Return success
    res.json({
      success: true,
      message: 'Code generated successfully',
      codeId: codeRecord.id,
      projectName,
      generatedCode
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ 
      error: 'Failed to generate code', 
      details: error.message 
    });
  }
});

// Simple GET endpoint
router.get('/', async (req, res) => {
  try {
    const { resources } = await generatedCodeContainer.items.readAll().fetchAll();
    res.json(resources);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
