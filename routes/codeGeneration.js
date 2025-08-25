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
    console.log('🚀 Request received:', req.body);
    
    const { projectName, actionButtonType, businessLogic, fieldBindingId } = req.body;

    // Basic validation
    if (!projectName || !actionButtonType || !businessLogic || !fieldBindingId) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ 
        error: 'Missing required fields' 
      });
    }

    console.log('📋 Looking for field binding:', fieldBindingId);

    // Get field binding - simple approach
    let fieldBinding;
    try {
      const { resource } = await fieldBindingsContainer.item(fieldBindingId, actionButtonType).read();
      fieldBinding = resource;
      console.log('✅ Found field binding via direct lookup:', fieldBinding?.name);
    } catch (error) {
      console.log('⚠️ Direct lookup failed, trying query:', error.message);
      // Fallback query
      const query = {
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: fieldBindingId }]
      };
      const { resources } = await fieldBindingsContainer.items.query(query).fetchAll();
      fieldBinding = resources.length > 0 ? resources[0] : null;
      if (fieldBinding) {
        console.log('✅ Found field binding via query:', fieldBinding.name);
      }
    }
    
    if (!fieldBinding) {
      console.log('❌ Field binding not found');
      return res.status(404).json({ error: 'Field binding not found' });
    }

    console.log('🤖 Calling AI...');

    // Simple AI prompt - no complex RAG for now
    const prompt = `Generate a basic JavaScript function for an O9 Planning action button:

Project: ${projectName}
Type: ${actionButtonType}
Logic: ${businessLogic}

Field Bindings: ${JSON.stringify(fieldBinding.fields, null, 2)}

Create a simple JavaScript function that implements this logic.`;

    // Call AI with better error handling
    let completion;
    try {
      completion = await openai.chat.completions.create({
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
      
      console.log('🤖 AI response received:', {
        hasChoices: !!completion?.choices,
        choicesLength: completion?.choices?.length,
        hasContent: !!completion?.choices?.[0]?.message?.content
      });
      
    } catch (aiError) {
      console.error('💥 AI call failed:', aiError.message);
      return res.status(500).json({ 
        error: 'AI service failed', 
        details: aiError.message 
      });
    }

    // Validate AI response
    if (!completion || !completion.choices || completion.choices.length === 0) {
      console.log('❌ Invalid AI response - no choices');
      return res.status(500).json({ 
        error: 'AI service returned invalid response',
        details: 'No choices in completion'
      });
    }

    if (!completion.choices[0] || !completion.choices[0].message || !completion.choices[0].message.content) {
      console.log('❌ Invalid AI response - no content');
      return res.status(500).json({ 
        error: 'AI service returned invalid response',
        details: 'No content in first choice'
      });
    }

    const generatedCode = completion.choices[0].message.content;
    console.log('✅ Generated code length:', generatedCode.length);

    console.log('💾 Saving to database...');

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

    const { resource } = await generatedCodeContainer.items.create(codeRecord);
    console.log('✅ Saved to database with ID:', resource.id);

    // Return success
    res.json({
      success: true,
      message: 'Code generated successfully',
      codeId: resource.id,
      projectName,
      generatedCode
    });

  } catch (error) {
    console.error('💥 Unexpected error:', error.message);
    console.error('💥 Stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to generate code', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Simple GET endpoint
router.get('/', async (req, res) => {
  try {
    console.log('📋 Fetching all generated code...');
    const { resources } = await generatedCodeContainer.items.readAll().fetchAll();
    console.log('✅ Found', resources.length, 'records');
    res.json(resources);
  } catch (error) {
    console.error('💥 Error fetching codes:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
