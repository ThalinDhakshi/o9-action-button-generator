const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { containers, containerClient, AzureOpenAIClient } = require('../config/azure');

const router = express.Router();
const openaiClient = new AzureOpenAIClient();

// Generate JavaScript code for Action Button
router.post('/', async (req, res) => {
  try {
    console.log('🚀 Code generation request received');
    
    const {
      projectName,
      actionButtonType,
      businessLogic,
      fieldBindingId
    } = req.body;

    // Validate required fields
    if (!projectName || !actionButtonType || !businessLogic || !fieldBindingId) {
      return res.status(400).json({ 
        error: 'Missing required fields: projectName, actionButtonType, businessLogic, fieldBindingId' 
      });
    }

    // Get field binding configuration with fallback
    let fieldBinding;
    try {
      const { resource } = await containers.fieldBindings.item(fieldBindingId, actionButtonType).read();
      fieldBinding = resource;
      console.log('✅ Found field binding via direct lookup');
    } catch (error) {
      console.log('⚠️ Direct lookup failed, trying query approach:', error.message);
      // Fallback to query if direct lookup fails
      const query = {
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: fieldBindingId }]
      };
      const { resources } = await containers.fieldBindings.items.query(query).fetchAll();
      fieldBinding = resources.length > 0 ? resources[0] : null;
      if (fieldBinding) {
        console.log('✅ Found field binding via query');
      }
    }
    
    if (!fieldBinding) {
      console.log('❌ Field binding not found');
      return res.status(404).json({ error: 'Field binding configuration not found' });
    }

    console.log('🔍 Searching knowledge base for examples...');
    
    // Get relevant knowledge base examples
    let examples = [];
    let exampleCodes = [];
    
    try {
      const knowledgeQuery = `
        SELECT * FROM c 
        WHERE c.type = "knowledge" 
        AND c.actionButtonType = @actionButtonType 
        AND c.fileType = "application/javascript"
        ORDER BY c.uploadedAt DESC
      `;

      const { resources: examplesFound } = await containers.knowledgeBase.items.query({
        query: knowledgeQuery,
        parameters: [{ name: '@actionButtonType', value: actionButtonType }]
      }).fetchAll();
      
      examples = examplesFound;
      console.log(`📚 Found ${examples.length} knowledge base examples`);

      // Get example code content
      for (const example of examples.slice(0, 3)) { // Use top 3 most recent examples
        try {
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
          console.log(`✅ Downloaded example: ${example.fileName}`);
        } catch (downloadError) {
          console.warn(`⚠️ Could not download example ${example.fileName}:`, downloadError.message);
        }
      }
      
      console.log(`📚 Successfully loaded ${exampleCodes.length} example codes`);
      
    } catch (knowledgeError) {
      console.log('⚠️ Knowledge base query failed:', knowledgeError.message);
      console.log('🔄 Continuing without examples...');
    }

    console.log('🤖 Generating code with Azure OpenAI...');

    // Generate code using Azure OpenAI
    const generatedCode = await generateActionButtonCode(
      projectName,
      actionButtonType,
      businessLogic,
      fieldBinding,
      exampleCodes
    );

    console.log('✅ Code generated successfully');

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
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
      status: 'generated'
    };

    const { resource } = await containers.generatedCode.items.create(codeRecord);
    
    console.log('✅ Saved to database with ID:', resource.id);

    res.json({
      message: 'JavaScript code generated successfully',
      codeId: resource.id,
      projectName,
      generatedCode,
      usedExamples: exampleCodes.length
    });

  } catch (error) {
    console.error('💥 Code generation error:', error.message);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

// Get generated code by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { projectId } = req.query;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId query parameter is required' });
    }
    
    const { resource } = await containers.generatedCode.item(id, projectId).read();
    
    if (!resource) {
      return res.status(404).json({ error: 'Generated code not found' });
    }

    res.json(resource);

  } catch (error) {
    console.error('Fetch generated code error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all generated codes for a project
router.get('/project/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    const query = `
      SELECT * FROM c 
      WHERE c.projectId = @projectId
      ORDER BY c.generatedAt DESC
    `;

    const { resources } = await containers.generatedCode.items.query({
      query,
      parameters: [{ name: '@projectId', value: projectId }]
    }).fetchAll();

    res.json(resources);

  } catch (error) {
    console.error('Fetch project codes error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Regenerate code with modifications
router.post('/:id/regenerate', async (req, res) => {
  try {
    const { id } = req.params;
    const { modifications, projectId } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    // Get existing code record
    const { resource: existingCode } = await containers.generatedCode.item(id, projectId).read();
    
    if (!existingCode) {
      return res.status(404).json({ error: 'Generated code not found' });
    }

    // Regenerate with modifications
    const modifiedBusinessLogic = `${existingCode.businessLogic}\n\nADDITIONAL MODIFICATIONS:\n${modifications}`;
    
    const regeneratedCode = await generateActionButtonCode(
      existingCode.projectName,
      existingCode.actionButtonType,
      modifiedBusinessLogic,
      existingCode.fieldBinding,
      [] // Use cached examples
    );

    // Update existing record
    const updatedRecord = {
      ...existingCode,
      generatedCode: regeneratedCode,
      businessLogic: modifiedBusinessLogic,
      generatedAt: new Date().toISOString(),
      version: incrementVersion(existingCode.version),
      status: 'regenerated'
    };

    const { resource } = await containers.generatedCode.item(id, projectId).replace(updatedRecord);

    res.json({
      message: 'JavaScript code regenerated successfully',
      codeId: resource.id,
      generatedCode: regeneratedCode,
      version: resource.version
    });

  } catch (error) {
    console.error('Code regeneration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download generated code as .js file
router.get('/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const { projectId } = req.query;

    if (!projectId) {
      return res.status(400).json({ error: 'projectId query parameter is required' });
    }
    
    const { resource } = await containers.generatedCode.item(id, projectId).read();
    
    if (!resource) {
      return res.status(404).json({ error: 'Generated code not found' });
    }

    const fileName = `${resource.projectName.replace(/[^a-zA-Z0-9]/g, '')}.js`;
    
    res.set({
      'Content-Type': 'application/javascript',
      'Content-Disposition': `attachment; filename="${fileName}"`
    });

    res.send(resource.generatedCode);

  } catch (error) {
    console.error('Download code error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get generation history
router.get('/history/all', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const query = `
      SELECT 
        c.id,
        c.projectName,
        c.actionButtonType,
        c.generatedAt,
        c.version,
        c.status
      FROM c 
      ORDER BY c.generatedAt DESC
      OFFSET 0 LIMIT @limit
    `;

    const { resources } = await containers.generatedCode.items.query({
      query,
      parameters: [{ name: '@limit', value: parseInt(limit) }]
    }).fetchAll();

    res.json(resources);

  } catch (error) {
    console.error('Fetch generation history error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to generate JavaScript code using Azure OpenAI
async function generateActionButtonCode(projectName, actionButtonType, businessLogic, fieldBinding, examples) {
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


${examples.length > 0 ? `REFERENCE EXAMPLES:\n${examples.map(ex => `--- ${ex.fileName} ---\n${ex.content}`).join('\n\n')}` : ''}

Generate the complete JavaScript module following the exact patterns from the examples. The module name should be "o9.${projectName.replace(/[^a-zA-Z0-9]/g, '')}"`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  console.log('🤖 Calling Azure OpenAI...');
  
  const response = await openaiClient.generateCompletion(messages, 4000, 0.1);
  
  if (!response.choices || response.choices.length === 0) {
    throw new Error('No code generated from AI service');
  }

  console.log('✅ Received AI response');
  return response.choices[0].message.content;
}

// Helper function to increment version
function incrementVersion(version) {
  const parts = version.split('.');
  const patch = parseInt(parts[2] || 0) + 1;
  return `${parts[0]}.${parts[1]}.${patch}`;
}

module.exports = router;
