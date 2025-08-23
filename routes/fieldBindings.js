const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { containers } = require('../config/azure');

const router = express.Router();

// Create new field binding configuration
router.post('/', async (req, res) => {
  try {
    const {
      name,
      actionButtonType,
      description,
      fields
    } = req.body;

    // Validate required fields
    if (!name || !actionButtonType || !fields || !Array.isArray(fields)) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, actionButtonType, and fields array' 
      });
    }

    // Validate field structure
    for (const field of fields) {
      if (!field.name || !field.dataType || !field.classification) {
        return res.status(400).json({ 
          error: 'Each field must have name, dataType, and classification' 
        });
      }
    }

    const fieldBinding = {
      id: uuidv4(),
      name,
      actionButtonType,
      description,
      fields,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true
    };

    const { resource } = await containers.fieldBindings.items.create(fieldBinding);

    res.status(201).json({
      message: 'Field binding created successfully',
      fieldBinding: resource
    });

  } catch (error) {
    console.error('Create field binding error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all field bindings
router.get('/', async (req, res) => {
  try {
    const { actionButtonType, isActive } = req.query;
    
    let query = 'SELECT * FROM c';
    const parameters = [];
    const conditions = [];

    if (actionButtonType) {
      conditions.push('c.actionButtonType = @actionButtonType');
      parameters.push({ name: '@actionButtonType', value: actionButtonType });
    }

    if (isActive !== undefined) {
      conditions.push('c.isActive = @isActive');
      parameters.push({ name: '@isActive', value: isActive === 'true' });
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY c.updatedAt DESC';

    const { resources } = await containers.fieldBindings.items.query({
      query,
      parameters
    }).fetchAll();

    res.json(resources);

  } catch (error) {
    console.error('Fetch field bindings error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get specific field binding
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { resource } = await containers.fieldBindings.item(id, req.query.actionButtonType).read();
    
    if (!resource) {
      return res.status(404).json({ error: 'Field binding not found' });
    }

    res.json(resource);

  } catch (error) {
    console.error('Fetch field binding error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update field binding
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Get existing field binding
    const { resource: existingBinding } = await containers.fieldBindings.item(id, updates.actionButtonType).read();
    
    if (!existingBinding) {
      return res.status(404).json({ error: 'Field binding not found' });
    }

    // Update fields
    const updatedBinding = {
      ...existingBinding,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    const { resource } = await containers.fieldBindings.item(id, updates.actionButtonType).replace(updatedBinding);

    res.json({
      message: 'Field binding updated successfully',
      fieldBinding: resource
    });

  } catch (error) {
    console.error('Update field binding error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete field binding
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { actionButtonType } = req.query;

    if (!actionButtonType) {
      return res.status(400).json({ error: 'actionButtonType query parameter is required' });
    }

    await containers.fieldBindings.item(id, actionButtonType).delete();

    res.json({ message: 'Field binding deleted successfully' });

  } catch (error) {
    console.error('Delete field binding error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get field binding templates for different action button types
router.get('/templates/action-button-types', async (req, res) => {
  try {
    const templates = {
      'Mass Edit/Add': {
        commonFields: [
          { name: 'VersionName', dataType: 'string', classification: 'dimension', required: true },
          { name: 'SKU', dataType: 'array', classification: 'dimension', required: true },
          { name: 'Store', dataType: 'array', classification: 'dimension', required: true },
          { name: 'StartDate', dataType: 'date', classification: 'dimension', required: true },
          { name: 'EndDate', dataType: 'date', classification: 'dimension', required: true }
        ],
        description: 'Fields commonly used in mass edit/add operations'
      },
      'Mass Delete': {
        commonFields: [
          { name: 'VersionName', dataType: 'string', classification: 'dimension', required: true },
          { name: 'SKU', dataType: 'array', classification: 'dimension', required: true },
          { name: 'Store', dataType: 'array', classification: 'dimension', required: true },
          { name: 'ConfirmDelete', dataType: 'boolean', classification: 'parameter', required: true }
        ],
        description: 'Fields commonly used in mass delete operations'
      },
      'Checkbox Edit/Add': {
        commonFields: [
          { name: 'VersionName', dataType: 'string', classification: 'dimension', required: true },
          { name: 'SelectedItems', dataType: 'array', classification: 'dimension', required: true },
          { name: 'EnableFlag', dataType: 'boolean', classification: 'parameter', required: true }
        ],
        description: 'Fields commonly used in checkbox-based edit/add operations'
      },
      'Checkbox Delete': {
        commonFields: [
          { name: 'VersionName', dataType: 'string', classification: 'dimension', required: true },
          { name: 'SelectedItems', dataType: 'array', classification: 'dimension', required: true },
          { name: 'ConfirmDelete', dataType: 'boolean', classification: 'parameter', required: true }
        ],
        description: 'Fields commonly used in checkbox-based delete operations'
      }
    };

    res.json(templates);

  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Validate field binding structure
router.post('/validate', async (req, res) => {
  try {
    const { fields } = req.body;

    if (!Array.isArray(fields)) {
      return res.status(400).json({ error: 'Fields must be an array' });
    }

    const validationErrors = [];
    const fieldNames = new Set();

    fields.forEach((field, index) => {
      // Check required properties
      if (!field.name) {
        validationErrors.push(`Field ${index + 1}: Missing name`);
      } else if (fieldNames.has(field.name)) {
        validationErrors.push(`Field ${index + 1}: Duplicate field name '${field.name}'`);
      } else {
        fieldNames.add(field.name);
      }

      if (!field.dataType) {
        validationErrors.push(`Field ${index + 1}: Missing dataType`);
      } else if (!['string', 'number', 'boolean', 'date', 'array'].includes(field.dataType)) {
        validationErrors.push(`Field ${index + 1}: Invalid dataType '${field.dataType}'`);
      }

      if (!field.classification) {
        validationErrors.push(`Field ${index + 1}: Missing classification`);
      } else if (!['dimension', 'measure', 'parameter'].includes(field.classification)) {
        validationErrors.push(`Field ${index + 1}: Invalid classification '${field.classification}'`);
      }
    });

    // Business logic validations
    const dimensions = fields.filter(f => f.classification === 'dimension');
    const measures = fields.filter(f => f.classification === 'measure');

    if (dimensions.length === 0) {
      validationErrors.push('At least one dimension field is required');
    }

    if (measures.length === 0) {
      validationErrors.push('At least one measure field is required for data operations');
    }

    const isValid = validationErrors.length === 0;

    res.json({
      isValid,
      errors: validationErrors,
      summary: {
        totalFields: fields.length,
        dimensions: dimensions.length,
        measures: measures.length,
        parameters: fields.filter(f => f.classification === 'parameter').length
      }
    });

  } catch (error) {
    console.error('Validate field binding error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clone existing field binding
router.post('/:id/clone', async (req, res) => {
  try {
    const { id } = req.params;
    const { newName, actionButtonType } = req.body;

    if (!newName) {
      return res.status(400).json({ error: 'newName is required for cloning' });
    }

    // Get original field binding
    const { resource: originalBinding } = await containers.fieldBindings.item(id, actionButtonType).read();
    
    if (!originalBinding) {
      return res.status(404).json({ error: 'Original field binding not found' });
    }

    // Create cloned binding
    const clonedBinding = {
      ...originalBinding,
      id: uuidv4(),
      name: newName,
      description: `Cloned from ${originalBinding.name}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    delete clonedBinding._rid;
    delete clonedBinding._self;
    delete clonedBinding._etag;
    delete clonedBinding._attachments;
    delete clonedBinding._ts;

    const { resource } = await containers.fieldBindings.items.create(clonedBinding);

    res.status(201).json({
      message: 'Field binding cloned successfully',
      fieldBinding: resource
    });

  } catch (error) {
    console.error('Clone field binding error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;