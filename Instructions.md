O9 Action Button Generator: Complete System Architecture Guide
Table of Contents

System Overview
Architecture Components
Azure Infrastructure
Project Structure
Core Application Files
Data Flow and Processing
API Endpoints
Deployment and Configuration

System Overview
The O9 Action Button Generator is a RAG-powered (Retrieval-Augmented Generation) web application that generates JavaScript code for O9 Planning action buttons. The system leverages Azure cloud services, artificial intelligence, and a React frontend to provide an enterprise-grade code generation platform.
Primary Purpose

Generate O9 Planning action button JavaScript modules
Utilize existing code examples through RAG methodology
Manage field binding configurations
Store and retrieve generated code with version control
Provide download and regeneration capabilities

Technology Stack

Backend: Node.js with Express.js framework
Frontend: React.js with modern UI components
Database: Azure Cosmos DB (NoSQL)
Storage: Azure Blob Storage
AI Service: Azure OpenAI (o4-mini model)
Hosting: Azure App Service
Version Control: Git with GitHub integration

Architecture Components
1. Three-Tier Architecture
Presentation Layer (Frontend)

React-based single-page application
User interface for code generation requests
Field binding configuration management
Code preview and download functionality

Application Layer (Backend)

Express.js REST API server
Business logic processing
AI integration and prompt management
Authentication and error handling

Data Layer (Storage)

Cosmos DB for structured data (field bindings, generated code)
Blob Storage for unstructured data (example files, knowledge base)
Azure OpenAI for AI processing

2. RAG Implementation
Knowledge Base Components:

Example JavaScript files stored in Azure Blob Storage
Metadata stored in Cosmos DB with file references
Dynamic retrieval based on action button type
Content processing and prompt enhancement

Retrieval Process:

Query knowledge base by action button type
Fetch relevant example files from Blob Storage
Process and format examples for AI context
Generate enhanced prompts with examples

Azure Infrastructure
Resource Group: o9-action-button-resources
Contains all related Azure resources for centralized management and billing.
1. Azure App Service

Name: o9-action-button-app
Purpose: Hosts the Node.js application
Configuration:

Linux-based container
Node.js 22.x runtime
Continuous deployment from GitHub
Environment variables for service connections



2. Azure Cosmos DB

Name: o9-action-button-cosmos
Purpose: Primary database for application data
Configuration:

NoSQL document database
Partition-based scaling
Multiple containers for data separation



Containers:

FieldBindings - Partition key: /actionButtonType
GeneratedCode - Partition key: /projectId
KnowledgeBase - Partition key: /type

3. Azure Blob Storage

Purpose: File storage for knowledge base examples
Container: Configured via environment variable
Access: Programmatic access for file upload/download
Integration: Metadata stored in Cosmos DB, content in Blob Storage

4. Azure OpenAI Service

Name: o9-action-button-openai-sweden
Location: Sweden Central
Model: o4-mini deployment
Purpose: Generate JavaScript code based on prompts and examples

Project Structure
o9-action-button-generator/
├── package.json                 # Node.js dependencies and scripts
├── server.js                    # Main Express server entry point
├── startup.js                   # Application initialization and error handling
├── config/
│   └── azure.js                # Azure services configuration and clients
├── routes/
│   ├── codeGeneration.js       # Code generation API endpoints
│   ├── fieldBindings.js        # Field binding CRUD operations
│   ├── knowledgeBase.js        # Knowledge base management
│   └── health.js               # Health check endpoint
├── public/
│   ├── index.html              # Main HTML file
│   ├── app.js                  # React application bundle
│   ├── style.css               # Application styling
│   └── assets/                 # Static assets (images, fonts)
└── README.md                   # Project documentation
Core Application Files
1. package.json
Purpose: Defines project metadata, dependencies, and build scripts.
Key Dependencies:

express: Web framework for Node.js
@azure/cosmos: Cosmos DB SDK
@azure/storage-blob: Blob Storage SDK
openai: Azure OpenAI integration
uuid: Unique identifier generation
cors: Cross-origin request handling
multer: File upload handling

Scripts:

start: Production server startup (node startup.js)
dev: Development mode with auto-reload
build: Frontend build process

2. startup.js
Purpose: Application initialization wrapper with error handling.
Functionality:

Azure services initialization
Environment variable validation
Error handling and graceful degradation
Server startup with fallback mechanisms

javascript// Key responsibilities:
- Initialize Azure connections
- Validate required environment variables
- Start Express server
- Handle startup failures gracefully
3. server.js
Purpose: Main Express application configuration.
Components:

Middleware setup (CORS, body parsing, static files)
Route registration
Error handling middleware
Server configuration

javascript// Route mounting:
app.use('/api/health', healthRoutes);
app.use('/api/field-bindings', fieldBindingRoutes);
app.use('/api/knowledge-base', knowledgeBaseRoutes);
app.use('/api/generate-code', codeGenerationRoutes);
4. config/azure.js
Purpose: Centralized Azure services configuration and client management.
Components:

CosmosClient: Database connection and operations
BlobServiceClient: File storage operations
AzureOpenAIClient: AI service integration
Container references: Pre-configured database containers
Initialization function: Ensure required resources exist

Key Features:

Connection pooling and reuse
Error handling and retry logic
Environment-based configuration
Service health monitoring

5. routes/codeGeneration.js
Purpose: Core code generation functionality and API endpoints.
Endpoints:

POST /: Generate new JavaScript code
GET /:id: Retrieve specific generated code
GET /project/:projectId: Get all codes for a project
POST /:id/regenerate: Modify and regenerate code
GET /:id/download: Download code as .js file
GET /history/all: View generation history

RAG Implementation:
javascript// RAG Process:
1. Retrieve field binding configuration
2. Query knowledge base for relevant examples
3. Download example code from Blob Storage
4. Construct AI prompt with examples and requirements
5. Generate code using Azure OpenAI
6. Store result with metadata
7. Return formatted response
AI Integration:

Sophisticated prompt engineering for O9-specific code
Example code integration for pattern matching
Field binding context for accurate code generation
Error handling for AI service limitations

6. routes/fieldBindings.js
Purpose: Manage field binding configurations that define action button parameters.
Data Model:
javascript{
  id: "unique-identifier",
  name: "Human readable name",
  actionButtonType: "MassEditAdd", // Partition key
  description: "Purpose description",
  fields: [
    {
      name: "Field name",
      dataType: "string|number|boolean|array",
      classification: "dimension|measure|parameter",
      required: true|false,
      description: "Field purpose"
    }
  ],
  createdAt: "ISO timestamp",
  updatedAt: "ISO timestamp",
  isActive: true|false
}
7. routes/knowledgeBase.js
Purpose: Manage example code files and metadata for RAG functionality.
Operations:

Upload example JavaScript files
Store metadata with file references
Query examples by action button type
Manage example lifecycle (create, update, delete)

8. public/index.html
Purpose: Single-page application container.
Structure:

React application mount point
Meta tags for SEO and mobile optimization
Script and stylesheet references
Basic HTML structure

9. public/app.js
Purpose: React application bundle containing the user interface.
Components:

Code generation form interface
Field binding management UI
Generated code preview and download
Knowledge base file upload interface
Project management and history views

Data Flow and Processing
1. Code Generation Flow
User Request → Field Binding Lookup → Knowledge Base Query → 
Example Retrieval → AI Prompt Construction → OpenAI API Call → 
Code Generation → Database Storage → Response Formatting
Detailed Steps:

Input Validation: Validate required fields (projectName, actionButtonType, businessLogic, fieldBindingId)
Field Binding Retrieval:

Primary: Direct lookup by ID and partition key
Fallback: Query-based search if direct lookup fails


Knowledge Base Search:

Query by action button type and file type
Retrieve top 3 most recent examples
Download content from Blob Storage


Prompt Engineering:

System prompt with O9 development guidelines
User prompt with project requirements
Example code integration for pattern matching


AI Processing:

Call Azure OpenAI with constructed prompts
Handle API limitations and errors
Validate response structure


Result Processing:

Generate unique code ID
Create comprehensive metadata record
Store in Cosmos DB with full context
Return formatted response



2. Data Consistency Patterns
Eventual Consistency: Cosmos DB provides eventual consistency across partitions
Partition Strategy: Logical partitioning by action button type and project ID
Error Handling: Graceful degradation when services are unavailable
Retry Logic: Automatic retry for transient failures
API Endpoints
Health and Monitoring

GET /api/health: System health check with service status

Field Binding Management

GET /api/field-bindings: Retrieve all field bindings
POST /api/field-bindings: Create new field binding
GET /api/field-bindings/:id: Get specific field binding
PUT /api/field-bindings/:id: Update field binding
DELETE /api/field-bindings/:id: Delete field binding

Knowledge Base Management

GET /api/knowledge-base: List all knowledge base entries
POST /api/knowledge-base: Upload new example file
GET /api/knowledge-base/:id: Get specific example
DELETE /api/knowledge-base/:id: Remove example

Code Generation (Primary Functionality)

POST /api/generate-code: Generate new JavaScript code
GET /api/generate-code/:id: Retrieve generated code
GET /api/generate-code/project/:projectId: Project-specific codes
POST /api/generate-code/:id/regenerate: Modify existing code
GET /api/generate-code/:id/download: Download as .js file
GET /api/generate-code/history/all: Generation history

Deployment and Configuration
Environment Variables
Azure Services:
COSMOS_ENDPOINT=https://o9-action-button-cosmos.documents.azure.com:443/
COSMOS_KEY=[database-access-key]
COSMOS_DATABASE_NAME=O9ActionButtonDB
AZURE_STORAGE_CONNECTION_STRING=[blob-storage-connection]
AZURE_STORAGE_CONTAINER_NAME=[container-name]
Azure OpenAI:
AZURE_OPENAI_ENDPOINT=https://testaisweden.cognitiveservices.azure.com/
AZURE_OPENAI_API_KEY=[api-key]
AZURE_OPENAI_DEPLOYMENT_NAME=o4-mini
AZURE_OPENAI_API_VERSION=2024-12-01-preview
Deployment Process

Code Commit: Push changes to GitHub repository
Continuous Integration: GitHub Actions or Azure DevOps pipeline
Build Process: npm install and dependency resolution
Deployment: Azure App Service automatic deployment
Initialization: Startup.js ensures Azure resources exist
Health Check: Automated verification of service health

Security Considerations
Authentication: Service-to-service authentication using API keys
Network Security: HTTPS enforcement and CORS configuration
Data Protection: Encryption at rest and in transit
Access Control: Role-based access to Azure resources
Secrets Management: Environment variables for sensitive data
Monitoring and Logging
Application Insights: Performance monitoring and error tracking
Azure Monitor: Infrastructure health and metrics
Custom Logging: Detailed application-level logging
Health Endpoints: Automated health checking
This architecture provides a scalable, maintainable, and enterprise-ready solution for AI-powered code generation within the O9 Planning ecosystem.
