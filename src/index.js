import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

async function managerRequest(env, method, path, body = null, params = {}) {
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

  const options = {
    method,
    headers: {
      "X-API-KEY": env.MANAGER_API_KEY,
      Accept: "application/json",
    },
  };

  if (body !== null) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Manager API ${method} failed with status ${response.status}: ${text}`
    );
  }

  if (!text) {
    return {
      success: true,
      status: response.status,
    };
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      success: true,
      status: response.status,
      response: text,
    };
  }
}

function createServer(env) {
  const server = new McpServer({
    name: "Manager MCP",
    version: "2.0.0",
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
        const data = await managerRequest(
          env,
          "GET",
          "sales-invoices",
          null,
          { pageSize: 1 }
        );

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
    "manager_read",
    {
      description:
        "Read Manager.io data. Read-only. Allowed collections: customers, sales-invoices, purchase-invoices, receipts, payments, bank-accounts.",
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
      const data = await managerRequest(
        env,
        "GET",
        collection,
        null,
        {
          term,
          pageSize,
          skip,
        }
      );

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
    "manager_create",
    {
      description:
        "Create a new Manager.io record. Allowed resources: customer, sales-invoice, purchase-invoice, receipt, payment.",
      inputSchema: {
        resource: z.enum([
          "customer",
          "sales-invoice",
          "purchase-invoice",
          "receipt",
          "payment",
        ]),
        data: z.record(z.any()),
        confirmation: z
          .string()
          .describe('Must be exactly "CREATE" to perform the creation'),
      },
    },
    async ({ resource, data, confirmation }) => {
      if (confirmation !== "CREATE") {
        return {
          content: [
            {
              type: "text",
              text:
                'Creation cancelled. confirmation must be exactly "CREATE".',
            },
          ],
        };
      }

      const formMap = {
        customer: "customer-form",
        "sales-invoice": "sales-invoice-form",
        "purchase-invoice": "purchase-invoice-form",
        receipt: "receipt-form",
        payment: "payment-form",
      };

      try {
        const result = await managerRequest(
          env,
          "POST",
          formMap[resource],
          data
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  action: "created",
                  resource,
                  result,
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
                  success: false,
                  action: "create",
                  resource,
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
    "manager_update",
    {
      description:
        "Update an existing Manager.io record by UUID key. Allowed resources: customer, sales-invoice, purchase-invoice, receipt, payment.",
      inputSchema: {
        resource: z.enum([
          "customer",
          "sales-invoice",
          "purchase-invoice",
          "receipt",
          "payment",
        ]),
        key: z.string().uuid(),
        data: z.record(z.any()),
        confirmation: z
          .string()
          .describe('Must be exactly "UPDATE" to perform the update'),
      },
    },
    async ({ resource, key, data, confirmation }) => {
      if (confirmation !== "UPDATE") {
        return {
          content: [
            {
              type: "text",
              text:
                'Update cancelled. confirmation must be exactly "UPDATE".',
            },
          ],
        };
      }

      const formMap = {
        customer: "customer-form",
        "sales-invoice": "sales-invoice-form",
        "purchase-invoice": "purchase-invoice-form",
        receipt: "receipt-form",
        payment: "payment-form",
      };

      try {
        const result = await managerRequest(
          env,
          "PUT",
          `${formMap[resource]}/${key}`,
          data
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  action: "updated",
                  resource,
                  key,
                  result,
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
                  success: false,
                  action: "update",
                  resource,
                  key,
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
        capabilities: ["read", "create", "update"],
      });
    }

    if (url.pathname === "/mcp") {
      return createMcpHandler(() => createServer(env))(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
};
