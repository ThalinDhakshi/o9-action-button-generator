const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { containers, containerClient, AzureOpenAIClient } = require('../config/azure');

const router = express.Router();
const openaiClient = new AzureOpenAIClient();

// Generate JavaScript code for Action Button
router.post('/', async (req, res) => {
  console.log('🚀 Code generation request received:', req.body);
  
  try {
    const {
      projectName,
      actionButtonType,
      businessLogic,
      fieldBindingId,
      additionalRequirements
    } = req.body;

    console.log('📋 Request parameters:', {
      projectName,
      actionButtonType,
      businessLogic: businessLogic?.substring(0, 100) + '...',
      fieldBindingId,
      hasAdditionalRequirements: !!additionalRequirements
    });

    // Validate required fields
    if (!projectName || !actionButtonType || !businessLogic || !fieldBindingId) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ 
        error: 'Missing required fields: projectName, actionButtonType, businessLogic, fieldBindingId' 
      });
    }

    console.log('🔍 Attempting to fetch field binding...');
    
    // Get field binding configuration with fallback
    let fieldBinding;
    try {
      console.log('📊 Trying direct lookup for field binding:', fieldBindingId, 'with partition key:', actionButtonType);
      const { resource } = await containers.fieldBindings.item(fieldBindingId, actionButtonType).read();
      fieldBinding = resource;
      console.log('✅ Field binding found via direct lookup:', fieldBinding?.name);
    } catch (error) {
      console.log('⚠️  Direct lookup failed, trying query approach:', error.message);
      // Fallback to query if direct lookup fails
      const query = {
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: fieldBindingId }]
      };
      console.log('🔍 Running query:', query);
      const { resources } = await containers.fieldBindings.items.query(query).fetchAll();
      fieldBinding = resources.length > 0 ? resources[0] : null;
      console.log('📊 Query result:', resources.length, 'items found');
      if (fieldBinding) {
        console.log('✅ Field binding found via query:', fieldBinding.name);
      }
    }
    
    if (!fieldBinding) {
      console.log('❌ Field binding not found with ID:', fieldBindingId);
      return res.status(404).json({ error: 'Field binding configuration not found' });
    }

    console.log('🔍 Searching for knowledge base examples...');
    
    // Get relevant knowledge base examples
    const knowledgeQuery = `
      SELECT * FROM c 
      WHERE c.type = "knowledge" 
      AND c.actionButtonType = @actionButtonType 
      AND c.fileType = "application/javascript"
      ORDER BY c.uploadedAt DESC
    `;

    try {
      const { resources: examples } = await containers.knowledgeBase.items.query({
        query: knowledgeQuery,
        parameters: [{ name: '@actionButtonType', value: actionButtonType }]
      }).fetchAll();
      
      console.log('📚 Found', examples.length, 'knowledge base examples');

      // Get example code content
      let exampleCodes = [];
      for (const example of examples.slice(0, 3)) { // Use top 3 most recent examples
        try {
          console.log('📥 Downloading example:', example.fileName);
          const blockBlobClient = containerClient.getBlockBlobClient(example.filePath);
          const downloadResponse = await blockBlobClient.download();
          
          const chunks = [];
          for await (const chunk of downloadResponse.readableStreamBody) {
            chunks.push(chunk);
          }
          const content = Buffer.concat(chunks).toString('utf-8');
          
          exampleCodes.push({
            fileName: example.fileName,
            content: content,
            description: example.description
          });
          console.log('✅ Successfully downloaded:', example.fileName, '(', content.length, 'chars)');
        } catch (downloadError) {
          console.warn('⚠️  Could not download example', example.fileName, ':', downloadError.message);
        }
      }
      
      console.log('📚 Successfully loaded', exampleCodes.length, 'example codes');
    } catch (knowledgeError) {
      console.log('⚠️  Knowledge base query failed:', knowledgeError.message);
      console.log('🔄 Continuing without examples...');
      var exampleCodes = []; // Define here if knowledge base fails
    }

    console.log('🤖 Generating code with AI...');
    
    // Generate code using Azure OpenAI
    const generatedCode = await generateActionButtonCode(
      projectName,
      actionButtonType,
      businessLogic,
      fieldBinding,
      exampleCodes,
      additionalRequirements
    );
    
    console.log('✅ AI code generation completed, length:', generatedCode?.length);

    console.log('💾 Saving to database...');
    
    // Store generated code
    const codeRecord = {
      id: uuidv4(),
      projectId: projectName.toLowerCase().replace(/[^a-z0-9]/g, ''),
      projectName,
      actionButtonType,
      businessLogic,
      fieldBindingId,
      fieldBinding,
      generatedCode,
      examples: exampleCodes.map(ex => ({ fileName: ex.fileName, description: ex.description })),
      additionalRequirements,
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
      status: 'generated'
    };

    console.log('📝 Creating database record with ID:', codeRecord.id, 'and projectId:', codeRecord.projectId);
    
    const { resource } = await containers.generatedCode.items.create(codeRecord);
    
    console.log('✅ Successfully saved to database:', resource.id);

    const response = {
      message: 'JavaScript code generated successfully',
      codeId: resource.id,
      projectName,
      generatedCode,
      usedExamples: exampleCodes.length
    };
    
    console.log('🎉 Sending successful response');
    res.json(response);

  } catch (error) {
    console.error('💥 CRITICAL ERROR in code generation:', error);
    console.error('💥 Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      error: 'Failed to generate code', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper function to generate JavaScript code using Azure OpenAI
async function generateActionButtonCode(projectName, actionButtonType, businessLogic, fieldBinding, examples, additionalRequirements) {
  console.log('🤖 Starting AI code generation...');
  
  const systemPrompt = `You are an expert o9 supply chain platform JavaScript developer. You specialize in generating Action Button JavaScript modules following EXACT syntax patterns.

CRITICAL REQUIREMENTS:
1. Follow the EXACT syntax structure from provided examples
2. Only change the module name and field binding references
3. Preserve ALL validation patterns, query structures, and error handling
4. Use field bindings data to construct proper scope statements
5. Maintain identical code structure to examples

FIELD BINDING CLASSIFICATIONS:
- Dimensions: Used for filtering and scope definition (SKU, Store, VersionName, dates)
- Measures: Target fields for data updates (values to be changed)
- Parameters: Control flags and options (boolean flags, settings)

STANDARD STRUCTURE:
\`\`\`javascript
define('o9.ModuleName',['o9/data/query', 'o9/data/cellset'],function(){
    var ActionButtonCall = function(o9Params) {
        var parsedParams = JSON.parse(o9Params);
        
        // Logging for all field bindings
        // Validation logic
        // Update queries with proper scope
        
        return RuleOutputToUI;
    };
    
    var ConcatenateMultiselect = function(value){
        if (Array.isArray(value)) {
            return value.join('","');
        }
        return value;
    };
    
    return {
        ActionButtonCall:ActionButtonCall
    };
});
\`\`\`

You must generate code that matches the examples exactly, changing only module names and field references.`;

  const userPrompt = `Generate an o9 Action Button JavaScript module with these specifications:

PROJECT NAME: ${projectName}
ACTION BUTTON TYPE: ${actionButtonType}
BUSINESS LOGIC: ${businessLogic}

FIELD BINDINGS:
${JSON.stringify(fieldBinding.fields, null, 2)}

${additionalRequirements ? `ADDITIONAL REQUIREMENTS: ${additionalRequirements}` : ''}

${examples.length > 0 ? `REFERENCE EXAMPLES:\n${examples.map(ex => `--- ${ex.fileName} ---\n${ex.content}`).join('\n\n')}` : ''}

Generate the complete JavaScript module following the exact patterns from the examples. The module name should be "o9.${projectName.replace(/[^a-zA-Z0-9]/g, '')}"`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  console.log('🤖 Calling Azure OpenAI with', messages.length, 'messages');
  
  try {
    const response = await openaiClient.generateCompletion(messages, 4000, 0.1);
    
    console.log('🤖 AI response received:', {
      hasChoices: !!response.choices,
      choicesLength: response.choices?.length,
      hasContent: !!response.choices?.[0]?.message?.content
    });
    
    if (!response.choices || response.choices.length === 0) {
      throw new Error('No code generated from AI service');
    }

    return response.choices[0].message.content;
  } catch (aiError) {
    console.error('💥 AI generation failed:', aiError);
    throw aiError;
  }
}

// Helper function to increment version
function incrementVersion(version) {
  const parts = version.split('.');
  const patch = parseInt(parts[2] || 0) + 1;
  return `${parts[0]}.${parts[1]}.${patch}`;
}

module.exports = router;
