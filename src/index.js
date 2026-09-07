import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

async function managerGet(env, path, params = {}) {
  if (!env.MANAGER_API_URL || !env.MANAGER_API_KEY) {
    throw new Error("Manager API credentials are not configured in Cloudflare.");
  }

  const base = env.MANAGER_API_URL.replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  const url = new URL(`${base}/${cleanPath}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-API-KEY": env.MANAGER_API_KEY,
      "Accept": "application/json",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Manager API request failed with status ${response.status}: ${text}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createServer(env) {
  const server = new McpServer({
    name: "Manager MCP",
    version: "1.1.0",
  });

  server.registerTool(
    "ping",
    {
      description: "Check whether the Manager MCP server is online",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "Manager MCP is online",
        },
      ],
    })
  );

  server.registerTool(
    "manager_connection_test",
    {
      description:
        "Test whether the MCP server can connect to Manager.io using the configured API credentials",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await managerGet(env, "sales-invoices", {
          pageSize: 1,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  connected: true,
                  message: "Manager.io API connection is working",
                  sample: data,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  connected: false,
                  error: String(error.message || error),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.registerTool(
    "list_sales_invoices",
    {
      description:
        "Read sales invoices from Manager.io. This tool is read-only and does not create, edit, or delete anything.",
      inputSchema: {
        term: z.string().optional().describe("Optional search term"),
        pageSize: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of invoices to return, maximum 100"),
        skip: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Number of invoices to skip"),
      },
    },
    async ({ term, pageSize = 20, skip = 0 }) => {
      const data = await managerGet(env, "sales-invoices", {
        term,
        pageSize,
        skip,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "manager_read",
    {
      description:
        "Read a permitted Manager.io API2 collection. Read-only. Allowed collections: customers, sales-invoices, purchase-invoices, receipts, payments, bank-accounts.",
      inputSchema: {
        collection: z.enum([
          "customers",
          "sales-invoices",
          "purchase-invoices",
          "receipts",
          "payments",
          "bank-accounts",
        ]),
        term: z.string().optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
        skip: z.number().int().min(0).optional(),
      },
    },
    async ({ collection, term, pageSize = 20, skip = 0 }) => {
      const data = await managerGet(env, collection, {
        term,
        pageSize,
        skip,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        status: "online",
        service: "Manager MCP",
        mcp_endpoint: "/mcp",
        mode: "read-only",
      });
    }

    if (url.pathname === "/mcp") {
      return createMcpHandler(() => createServer(env))(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
};
