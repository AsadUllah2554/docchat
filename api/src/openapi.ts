const error = { type: "object", properties: { error: { type: "string" } }, required: ["error"] };
const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

const auth = [{ bearerAuth: [] }];
const idParam = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "DocChat API",
    version: "1.0.0",
    description:
      "Retrieval-augmented question answering over a document set. Every answer cites the chunks it used, and questions the documents cannot answer are refused — below the similarity threshold, without calling the model at all.\n\nDemo account: `demo@docchat.dev` / `docchat-demo`. Log in with **POST /auth/login**, then use **Authorize** with the token.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "Auth" },
    { name: "Documents", description: "Ingestion and chunk inspection" },
    { name: "Query", description: "Cited, streamed answers" },
    { name: "System" },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: error,
      Credentials: {
        type: "object",
        required: ["email", "password"],
        properties: { email: { type: "string", format: "email", example: "demo@docchat.dev" }, password: { type: "string", minLength: 8, example: "docchat-demo" } },
      },
      AuthResponse: {
        type: "object",
        properties: {
          token: { type: "string" },
          user: { type: "object", properties: { id: { type: "string" }, email: { type: "string" }, role: { type: "string", enum: ["member", "admin"] } } },
        },
      },
      Document: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          source: { type: "string", description: "Original filename" },
          uploadedAt: { type: "string", format: "date-time" },
          chunkCount: { type: "integer" },
          chunkTokenCounts: { type: "array", items: { type: "integer" }, description: "Token count of each chunk, in order" },
        },
      },
      Chunk: {
        type: "object",
        properties: {
          id: { type: "integer" },
          chunkIndex: { type: "integer" },
          sectionHeading: { type: ["string", "null"], description: "Nearest heading at or above the chunk start" },
          label: { type: "string", description: "Citation label, e.g. 4.2 or 5–6", example: "4.2" },
          tokenCount: { type: "integer", description: "Counted with the embedding model's tokenizer" },
          content: { type: "string" },
        },
      },
      RetrievedChunk: {
        allOf: [
          { $ref: "#/components/schemas/Chunk" },
          { type: "object", properties: { documentId: { type: "string" }, documentTitle: { type: "string" }, similarity: { type: "number", example: 0.74 } } },
        ],
      },
    },
  },
  paths: {
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Create a member account",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Credentials" } } } },
        responses: {
          "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } } },
          "400": errorResponse("Invalid email or password"),
          "409": errorResponse("Email already registered"),
          "429": errorResponse("Too many attempts"),
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Log in and get a JWT",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Credentials" } } } },
        responses: {
          "200": { description: "Logged in", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } } },
          "401": errorResponse("Wrong email or password"),
          "429": errorResponse("Too many attempts"),
        },
      },
    },
    "/documents": {
      get: {
        tags: ["Documents"],
        summary: "List indexed documents with chunk counts",
        security: auth,
        responses: {
          "200": {
            description: "Documents",
            content: { "application/json": { schema: { type: "object", properties: { documents: { type: "array", items: { $ref: "#/components/schemas/Document" } } } } } },
          },
          "401": errorResponse("Missing or invalid token"),
        },
      },
      post: {
        tags: ["Documents"],
        summary: "Upload, chunk, embed and store a document",
        description: "Accepts .md, .txt or .pdf up to 5 MB. Ingestion is synchronous. Files with no extractable text (scanned PDFs) are rejected with 422.",
        security: auth,
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" }, title: { type: "string" } } },
            },
          },
        },
        responses: {
          "201": { description: "Ingested", content: { "application/json": { schema: { $ref: "#/components/schemas/Document" } } } },
          "401": errorResponse("Missing or invalid token"),
          "413": errorResponse("File too large"),
          "415": errorResponse("Unsupported file type"),
          "422": errorResponse("No extractable text"),
        },
      },
    },
    "/documents/{id}/chunks": {
      get: {
        tags: ["Documents"],
        summary: "Inspect how a document was chunked",
        security: auth,
        parameters: [idParam],
        responses: {
          "200": {
            description: "The document and its chunks in order",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    document: { $ref: "#/components/schemas/Document" },
                    settings: { type: "object", properties: { chunkTokens: { type: "integer" }, overlapTokens: { type: "integer" }, embeddingMaxTokens: { type: "integer" } } },
                    chunks: { type: "array", items: { $ref: "#/components/schemas/Chunk" } },
                  },
                },
              },
            },
          },
          "401": errorResponse("Missing or invalid token"),
          "404": errorResponse("Document not found"),
        },
      },
    },
    "/documents/{id}": {
      delete: {
        tags: ["Documents"],
        summary: "Delete a document and its chunks (admin)",
        security: auth,
        parameters: [idParam],
        responses: { "204": { description: "Deleted" }, "401": errorResponse("Missing or invalid token"), "403": errorResponse("Not an admin"), "404": errorResponse("Document not found") },
      },
    },
    "/query": {
      post: {
        tags: ["Query"],
        summary: "Ask a question; stream a cited answer",
        description:
          "Responds with a Server-Sent Events stream in the Vercel AI SDK UI message stream format (`x-vercel-ai-ui-message-stream: v1`). Parts, in order:\n\n1. `data-sources` — the top-k retrieved chunks with similarity scores, sent before any answer text\n2. `text-start` / `text-delta` / `text-end` — the answer, citing chunks inline as `[chunk:ID]`\n3. `data-meta` — query id, latency, provider, model, tokens, estimated cost\n\nIf the best match scores below the similarity threshold, a `data-refusal` part is sent instead of text and **no model call is made**. If the model finds the excerpts do not answer the question, `data-refusal` is sent with `reason: model`.",
        security: auth,
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["question"], properties: { question: { type: "string", example: "What is the notice period for terminating a retainer?" } } } } },
        },
        responses: {
          "200": { description: "SSE stream", content: { "text/event-stream": { schema: { type: "string" } } } },
          "400": errorResponse("Invalid question"),
          "401": errorResponse("Missing or invalid token"),
          "429": errorResponse("Rate limited"),
        },
      },
    },
    "/queries": {
      get: {
        tags: ["Query"],
        summary: "Query history with refusal rate, latency and cost",
        security: auth,
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
          { name: "all", in: "query", schema: { type: "boolean" }, description: "Admins only: every user's queries" },
        ],
        responses: { "200": { description: "History and summary stats" }, "401": errorResponse("Missing or invalid token") },
      },
    },
    "/health": {
      get: {
        tags: ["System"],
        summary: "Liveness and index status",
        responses: { "200": { description: "OK" }, "503": { description: "Database unreachable" } },
      },
    },
  },
};
