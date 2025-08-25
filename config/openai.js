// config/openai.js
const endpoint = process.env.AZURE_OPENAI_ENDPOINT; // e.g., https://...cognitiveservices.azure.com/
const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-01-01-preview";
const deployment =
  process.env.AZURE_OPENAI_DEPLOYMENT ||
  process.env.AZURE_OPENAI_DEPLOYMENT_NAME; // support either name
const apiKey = process.env.AZURE_OPENAI_API_KEY;

if (!endpoint || !apiVersion || !deployment || !apiKey) {
  console.warn("[openai] Missing one or more env vars:",
    { endpoint: !!endpoint, apiVersion: !!apiVersion, deployment: !!deployment, apiKey: !!apiKey });
}

const buildChatUrl = () =>
  `${endpoint}openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

module.exports = {
  buildChatUrl,
  apiKey,
};
