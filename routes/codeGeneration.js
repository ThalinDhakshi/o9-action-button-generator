// routes/codeGeneration.js (drop-in replacement)
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { containers, containerClient } = require("../config/azure");
const { buildChatUrl, apiKey } = require("../config/openai");

const router = express.Router();

// If using Node <18, uncomment the two lines below and add node-fetch to package.json
// const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1"; // keep TLS verification on

// ---- Azure OpenAI call helper (chat/completions) ----
async function callAzureChat(messages, maxTokens = 1600) {
  const res = await fetch(buildChatUrl(), {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messages,
      // IMPORTANT for 2025-01-01-preview:
      // - use max_completion_tokens (NOT max_tokens)
      // - do NOT send temperature (fixed for your model)
      max_completion_tokens: maxTokens
    })
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = `[AzureOpenAI] ${res.status} ${res.statusText}`;
    console.error(msg, data);
    const err = new Error(data?.error?.message || msg);
    err.status = res.status;
    err.details = data;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("No content returned from model");
  return content;
}

// ---- Generate JavaScript code for Action Button ----
router.post("/", async (req, res) => {
  try {
    const {
      projectName,
      actionButtonType,
      businessLogic,
      fieldBindingId,
      additionalRequirements
    } = req.body || {};

    // Validate required fields
    if (!projectName || !actionButtonType || !businessLogic || !fieldBindingId) {
      return res.status(400).json({
        error:
          "Missing required fields: projectName, actionButtonType, businessLogic, fieldBindingId"
      });
    }

    // -------- Get field binding configuration (robust) --------
    let fieldBinding;
    try {
      const resp = await containers.fieldBindings
        .item(fieldBindingId, actionButtonType) // pk should be /actionButtonType
        .read();
      fieldBinding = resp.resource;
    } catch (e) {
      console.warn("[fieldBindings.read] miss; falling back to query", {
        id: fieldBindingId,
        pk: actionButtonType,
        code: e?.code,
        message: e?.message
      });
      const { resources } = await containers.fieldBindings.items
        .query({
          query: "SELECT * FROM c WHERE c.id = @id AND c.actionButtonType = @pk",
          parameters: [
            { name: "@id", value: fieldBindingId },
            { name: "@pk", value: actionButtonType }
          ]
        })
        .fetchAll();
      fieldBinding = resources?.[0];
    }

    if (!fieldBinding) {
      return res.status(404).json({ error: "Field binding configuration not found" });
    }

    // -------- Get relevant knowledge base examples --------
    const knowledgeQuery = `
      SELECT * FROM c
      WHERE c.type = "knowledge"
        AND c.actionButtonType = @actionButtonType
        AND c.fileType = "application/javascript"
      ORDER BY c.uploadedAt DESC
    `;

    const { resources: examples } = await containers.knowledgeBase.items
      .query({
        query: knowledgeQuery,
        parameters: [{ name: "@actionButtonType", value: actionButtonType }]
      })
      .fetchAll();

    // Download example code content (cap per-example length to limit tokens)
    const exampleCodes = [];
    for (const example of (examples || []).slice(0, 3)) {
      try {
        const blockBlobClient = containerClient.getBlockBlobClient(example.filePath);
        const downloadResponse = await blockBlobClient.download();
        const chunks = [];
        for await (const chunk of downloadResponse.readableStreamBody) chunks.push(chunk);
        let content = Buffer.concat(chunks).toString("utf-8");
        if (content.length > 6000) {
          content = content.slice(0, 6000) + "\n/* ...truncated for prompt size... */";
        }
        exampleCodes.push({
          fileName: example.fileName,
          content,
          description: example.description
        });
      } catch (downloadError) {
        console.warn(`Could not download example ${example?.fileName}:`, downloadError?.message);
      }
    }

    // -------- Build prompts --------
    const systemPrompt = `You are an expert o9 supply chain platform JavaScript developer.
You generate Action Button JavaScript modules that strictly follow the examples' structure.

CRITICAL REQUIREMENTS:
1) Follow the exact module structure from the examples
2) Only modify module name and field binding references
3) Preserve validation, query patterns, and error handling
4) Use field binding data (Dimensions/Measures/Parameters) correctly
5) Keep code production-ready and consistent`;

    const moduleName = `o9.${String(projectName).replace(/[^a-zA-Z0-9]/g, "")}`;
    const fieldBindingBlock = JSON.stringify(fieldBinding?.fields || {}, null, 2);

    const userPrompt =
      `Generate a complete o9 Action Button JS module.\n\n` +
      `PROJECT NAME: ${projectName}\n` +
      `ACTION BUTTON TYPE: ${actionButtonType}\n` +
      `BUSINESS LOGIC:\n${businessLogic}\n\n` +
      `FIELD BINDINGS (JSON):\n${fieldBindingBlock}\n\n` +
      (additionalRequirements ? `ADDITIONAL REQUIREMENTS:\n${additionalRequirements}\n\n` : "") +
      (exampleCodes.length
        ? `REFERENCE EXAMPLES:\n${exampleCodes
            .map((ex) => `--- ${ex.fileName} ---\n${ex.content}`)
            .join("\n\n")}\n\n`
        : "") +
      `The module name must be "${moduleName}".`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];

    const generatedCode = await callAzureChat(messages, 1600);

    // -------- Store generated code --------
    const codeRecord = {
      id: uuidv4(),
      projectId: String(projectName).toLowerCase().replace(/[^a-z0-9]/g, ""),
      projectName,
      actionButtonType,
      businessLogic,
      fieldBindingId,
      fieldBinding,
      generatedCode,
      examples: exampleCodes.map((ex) => ({ fileName: ex.fileName, description: ex.description })),
      additionalRequirements,
      generatedAt: new Date().toISOString(),
      version: "1.0.0",
      status: "generated"
    };

    const { resource } = await containers.generatedCode.items.create(codeRecord);

    return res.json({
      message: "JavaScript code generated successfully",
      codeId: resource.id,
      projectName,
      generatedCode,
      usedExamples: exampleCodes.length
    });
  } catch (error) {
    console.error("Code generation error:", error);
    return res.status(error.status || 500).json({
      error: error.message,
      details: error.details
    });
  }
});

// ---- Get generated code by ID ----
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: "projectId query parameter is required" });

    const { resource } = await containers.generatedCode.item(id, projectId).read();
    if (!resource) return res.status(404).json({ error: "Generated code not found" });

    return res.json(resource);
  } catch (error) {
    console.error("Fetch generated code error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// ---- Get all generated codes for a project ----
router.get("/project/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const query = `
      SELECT * FROM c 
      WHERE c.projectId = @projectId
      ORDER BY c.generatedAt DESC
    `;
    const { resources } = await containers.generatedCode.items
      .query({ query, parameters: [{ name: "@projectId", value: projectId }] })
      .fetchAll();

    return res.json(resources);
  } catch (error) {
    console.error("Fetch project codes error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// ---- Regenerate code with modifications ----
router.post("/:id/regenerate", async (req, res) => {
  try {
    const { id } = req.params;
    const { modifications, projectId } = req.body || {};
    if (!projectId) return res.status(400).json({ error: "projectId is required" });

    const { resource: existingCode } = await containers.generatedCode.item(id, projectId).read();
    if (!existingCode) return res.status(404).json({ error: "Generated code not found" });

    const modifiedBusinessLogic =
      `${existingCode.businessLogic}\n\nADDITIONAL MODIFICATIONS:\n${modifications || ""}`;

    const messages = [
      { role: "system", content: "You refine JS modules while preserving structure and validations." },
      {
        role: "user",
        content:
          `Regenerate the module with these modifications while preserving structure.\n\n` +
          `ORIGINAL LOGIC:\n${existingCode.businessLogic}\n\n` +
          `FIELD BINDINGS:\n${JSON.stringify(existingCode.fieldBinding?.fields || {}, null, 2)}\n\n` +
          `MODIFICATIONS:\n${modifications || ""}\n\n` +
          `Module name: o9.${existingCode.projectName.replace(/[^a-zA-Z0-9]/g, "")}`
      }
    ];

    const regeneratedCode = await callAzureChat(messages, 1600);

    const updatedRecord = {
      ...existingCode,
      generatedCode: regeneratedCode,
      businessLogic: modifiedBusinessLogic,
      generatedAt: new Date().toISOString(),
      version: incrementVersion(existingCode.version),
      status: "regenerated"
    };

    const { resource } = await containers.generatedCode.item(id, projectId).replace(updatedRecord);
    return res.json({
      message: "JavaScript code regenerated successfully",
      codeId: resource.id,
      generatedCode: regeneratedCode,
      version: resource.version
    });
  } catch (error) {
    console.error("Code regeneration error:", error);
    return res.status(error.status || 500).json({ error: error.message, details: error.details });
  }
});

// ---- Download generated code as .js file ----
router.get("/:id/download", async (req, res) => {
  try {
    const { id } = req.params;
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: "projectId query parameter is required" });

    const { resource } = await containers.generatedCode.item(id, projectId).read();
    if (!resource) return res.status(404).json({ error: "Generated code not found" });

    const safe = (s) => (s || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50);
    const fileName = `${safe(resource.projectName) || "generated"}.js`;

    res.set({
      "Content-Type": "application/javascript",
      "Content-Disposition": `attachment; filename="${fileName}"`
    });
    return res.send(resource.generatedCode || "");
  } catch (error) {
    console.error("Download code error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// ---- Helper: increment patch version ----
function incrementVersion(version = "1.0.0") {
  const parts = String(version).split(".");
  const major = Number(parts[0] || 1);
  const minor = Number(parts[1] || 0);
  const patch = Number(parts[2] || 0) + 1;
  return `${major}.${minor}.${patch}`;
}

module.exports = router;
