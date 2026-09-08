import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

async function managerRequest(env, method, path, body = null, params = {}) {
  if (!env.MANAGER_API_URL || !env.MANAGER_API_KEY) {
    throw new Error("Manager connection is not configured.");
  }

  const base = env.MANAGER_API_URL.replace(/\/+$/, "");
  const cleanPath = String(path || "").replace(/^\/+/, "");
  const url = new URL(cleanPath ? `${base}/${cleanPath}` : base);

  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
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
    return { success: true, status: response.status };
  }

  try {
    return JSON.parse(text);
  } catch {
    return { success: true, status: response.status, response: text };
  }
}

function toolText(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function assertSafeReadPath(path) {
  const clean = String(path || "").trim().replace(/^\/+/, "");

  if (!clean) {
    throw new Error("A Manager.io API path is required.");
  }

  if (!/^[a-z0-9\-_/]+$/i.test(clean)) {
    throw new Error("Path contains unsupported characters.");
  }

  const blocked = [
    /^access-tokens?(\/|$)/i,
    /^api-keys?(\/|$)/i,
    /^users?(\/|$)/i,
    /^roles?(\/|$)/i,
    /^permissions?(\/|$)/i,
    /^authentication(\/|$)/i,
    /^security(\/|$)/i,
  ];

  if (blocked.some((rule) => rule.test(clean))) {
    throw new Error(
      "This administrative/security path is intentionally blocked."
    );
  }

  return clean;
}

function createServer(env) {
  const server = new McpServer({
    name: "Manager MCP",
    version: "3.0.0",
  });

  server.registerTool(
    "ping",
    {
      description: "Check whether the Manager MCP server is online",
      inputSchema: {},
    },
    async () => toolText("Manager MCP is online")
  );

  server.registerTool(
    "manager_connection_test",
    {
     description:
  "Test whether the Manager.io connection is working",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await managerRequest(
          env,
          "GET",
          "sales-invoices",
          null,
          {
            pageSize: 1,
          }
        );

        return toolText({
          connected: true,
          message: "Manager.io API connection is working",
          sample: data,
        });
      } catch (error) {
        return toolText({
          connected: false,
          error: String(error.message || error),
        });
      }
    }
  );

  server.registerTool(
    "manager_discover_api",
    {
      description:
        "Read Manager.io's API2 OpenAPI schema and list matching endpoint paths. Use this to discover exact inventory, report, customer, supplier, transaction, and other read endpoints instead of guessing endpoint names.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            "Keyword such as inventory, supplier, report, balance, profit, customer, sales, purchase"
          ),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ query, limit = 50 }) => {
      const schema = await managerRequest(env, "GET", "");

      const paths =
        schema?.paths && typeof schema.paths === "object"
          ? schema.paths
          : {};

      const q = query.toLowerCase();

      const matches = Object.keys(paths)
        .filter((path) => path.toLowerCase().includes(q))
        .slice(0, limit)
        .map((path) => ({
          path,
          methods: Object.keys(paths[path] || {}).filter((m) =>
            ["get", "post", "put", "delete", "patch"].includes(
              m.toLowerCase()
            )
          ),
        }));

      return toolText({
        query,
        count: matches.length,
        matches,
      });
    }
  );

  server.registerTool(
    "manager_safe_read",
    {
      description:
        "Broad READ-ONLY access to Manager.io API2. Use manager_discover_api first when unsure of an endpoint. Administrative/security endpoints such as access tokens and users are blocked. This tool never writes, updates, or deletes.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe(
            'API2 path without the domain, for example "inventory-items" or "balance-sheet-view/<uuid>"'
          ),
        params: z.record(z.any()).optional(),
      },
    },
    async ({ path, params = {} }) => {
      try {
        const cleanPath = assertSafeReadPath(path);

        const data = await managerRequest(
          env,
          "GET",
          cleanPath,
          null,
          params
        );

        return toolText(data);
      } catch (error) {
        return toolText({
          success: false,
          error: String(error.message || error),
        });
      }
    }
  );

  server.registerTool(
    "manager_read",
    {
      description:
        "Convenient read-only access to common accounting collections including customers, suppliers, inventory items, invoices, receipts, payments, and bank accounts.",
      inputSchema: {
        collection: z.enum([
          "customers",
          "suppliers",
          "inventory-items",
          "non-inventory-items",
          "sales-invoices",
          "purchase-invoices",
          "receipts",
          "payments",
          "bank-accounts",
          "inventory-item-qty-owned",
          "inventory-item-qty-on-order",
          "inventory-item-qty-on-hand-transactions",
          "inventory-unit-costs",
          "inventory-transfer-lines",
        ]),
        term: z.string().optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
        skip: z.number().int().min(0).optional(),
        extraParams: z.record(z.any()).optional(),
      },
    },
    async ({
      collection,
      term,
      pageSize = 20,
      skip = 0,
      extraParams = {},
    }) => {
      try {
        const data = await managerRequest(
          env,
          "GET",
          collection,
          null,
          {
            term,
            pageSize,
            skip,
            ...extraParams,
          }
        );

        return toolText(data);
      } catch (error) {
        return toolText({
          success: false,
          collection,
          error: String(error.message || error),
        });
      }
    }
  );

  server.registerTool(
    "manager_resolve",
    {
      description:
        "Resolve a human name/code/reference to Manager.io records before creating an invoice or other transaction. Use this for customer, supplier, inventory item, or non-inventory item matching. Never guess when multiple matches exist.",
      inputSchema: {
        type: z.enum([
          "customer",
          "supplier",
          "inventory-item",
          "non-inventory-item",
        ]),
        term: z.string().min(1),
        pageSize: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ type, term, pageSize = 10 }) => {
      const map = {
        customer: "customers",
        supplier: "suppliers",
        "inventory-item": "inventory-items",
        "non-inventory-item": "non-inventory-items",
      };

      try {
        const data = await managerRequest(
          env,
          "GET",
          map[type],
          null,
          {
            term,
            pageSize,
            skip: 0,
          }
        );

        return toolText({
          instruction:
            "If more than one plausible match is returned, ask the user which record to use. Do not create a transaction using an ambiguous match.",
          type,
          term,
          results: data,
        });
      } catch (error) {
        return toolText({
          success: false,
          type,
          term,
          error: String(error.message || error),
        });
      }
    }
  );

  server.registerTool(
    "manager_inventory_check",
    {
      description:
        "Read-only inventory/accountant check. Find an inventory item by name/code and return item details plus quantity-owned, quantity-on-order, recent quantity-on-hand transactions, and recent unit costs where available.",
      inputSchema: {
        term: z.string().min(1),
        pageSize: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ term, pageSize = 20 }) => {
      try {
        const [
          items,
          owned,
          onOrder,
          movements,
          costs,
        ] = await Promise.all([
          managerRequest(
            env,
            "GET",
            "inventory-items",
            null,
            {
              term,
              pageSize,
            }
          ),

          managerRequest(
            env,
            "GET",
            "inventory-item-qty-owned",
            null,
            {
              term,
              pageSize,
            }
          ),

          managerRequest(
            env,
            "GET",
            "inventory-item-qty-on-order",
            null,
            {
              term,
              pageSize,
            }
          ),

          managerRequest(
            env,
            "GET",
            "inventory-item-qty-on-hand-transactions",
            null,
            {
              term,
              pageSize,
            }
          ),

          managerRequest(
            env,
            "GET",
            "inventory-unit-costs",
            null,
            {
              term,
              pageSize,
            }
          ),
        ]);

        return toolText({
          term,
          inventoryItems: items,
          qtyOwned: owned,
          qtyOnOrder: onOrder,
          qtyOnHandTransactions: movements,
          unitCosts: costs,
          accountantInstruction:
            "Use these datasets to flag negative/low stock, unusual cost changes, price-vs-cost anomalies, or mismatches. Do not change inventory automatically.",
        });
      } catch (error) {
        return toolText({
          success: false,
          term,
          error: String(error.message || error),
        });
      }
    }
  );

  server.registerTool(
    "manager_prepare_sales_invoice",
    {
      description:
        "READ-ONLY preparation step for a sales invoice from customer name and product names. Resolves customer and inventory candidates and returns supporting data. It never creates the invoice. If any match is ambiguous, ask the user before proceeding.",
      inputSchema: {
        customerName: z.string().min(1),
        items: z
          .array(
            z.object({
              name: z.string().min(1),
              quantity: z.number().positive(),
              unitPrice: z.number().nonnegative(),
            })
          )
          .min(1)
          .max(50),
      },
    },
    async ({ customerName, items }) => {
      try {
        const customer = await managerRequest(
          env,
          "GET",
          "customers",
          null,
          {
            term: customerName,
            pageSize: 10,
          }
        );

        const resolvedItems = [];

        for (const item of items) {
          const matches = await managerRequest(
            env,
            "GET",
            "inventory-items",
            null,
            {
              term: item.name,
              pageSize: 10,
            }
          );

          resolvedItems.push({
            requested: item,
            matches,
          });
        }

        return toolText({
          readyToCreate: false,
          customerName,
          customerMatches: customer,
          items: resolvedItems,
          requiredNextSteps: [
            "Confirm exactly one customer record.",
            "Confirm exactly one inventory item for every requested line.",
            "Check stock/cost/current item details when relevant.",
            "Inspect an existing sales invoice with manager_get_form to learn the exact Manager.io form payload.",
            "Show the proposed invoice to the user and obtain explicit CREATE confirmation before calling manager_create.",
          ],
        });
      } catch (error) {
        return toolText({
          success: false,
          error: String(error.message || error),
        });
      }
    }
  );

  server.registerTool(
    "manager_audit_pack",
    {
      description:
        "Read-only accountant audit pack for finding disparities. Returns selected datasets for comparison; the AI should explain anomalies but must not modify records automatically.",
      inputSchema: {
        scope: z.enum([
          "sales",
          "purchases",
          "inventory",
          "cash",
          "customer",
          "supplier",
        ]),
        term: z.string().optional(),
        pageSize: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ scope, term, pageSize = 30 }) => {
      const groups = {
        sales: [
          "customers",
          "sales-invoices",
          "receipts",
        ],

        purchases: [
          "suppliers",
          "purchase-invoices",
          "payments",
        ],

        inventory: [
          "inventory-items",
          "inventory-item-qty-owned",
          "inventory-item-qty-on-order",
          "inventory-item-qty-on-hand-transactions",
          "inventory-unit-costs",
        ],

        cash: [
          "bank-accounts",
          "receipts",
          "payments",
        ],

        customer: [
          "customers",
          "sales-invoices",
          "receipts",
        ],

        supplier: [
          "suppliers",
          "purchase-invoices",
          "payments",
        ],
      };

      try {
        const output = {};

        for (const collection of groups[scope]) {
          output[collection] = await managerRequest(
            env,
            "GET",
            collection,
            null,
            {
              term,
              pageSize,
              skip: 0,
            }
          );
        }

        return toolText({
          scope,
          term: term || null,
          data: output,
          accountantInstruction:
            "Compare records for duplicates, unexplained price/cost changes, unpaid items, missing or unusual payments/receipts, inventory mismatches, or other disparities. Report findings first. Do not make corrections automatically.",
        });
      } catch (error) {
        return toolText({
          success: false,
          scope,
          error: String(error.message || error),
        });
      }
    }
  );

  server.registerTool(
    "manager_report_view",
    {
      description:
        "Read an existing Manager.io report view by UUID key. Supports common accounting reports. Read-only.",
      inputSchema: {
        report: z.enum([
          "balance-sheet",
          "profit-and-loss-statement",
          "receipts-and-payments-summary",
          "inventory-profit-margin",
        ]),
        key: z.string().uuid(),
      },
    },
    async ({ report, key }) => {
      const map = {
        "balance-sheet": "balance-sheet-view",
        "profit-and-loss-statement":
          "profit-and-loss-statement-view",
        "receipts-and-payments-summary":
          "receipts-and-payments-summary-view",
        "inventory-profit-margin":
          "inventory-profit-margin-view",
      };

      try {
        const data = await managerRequest(
          env,
          "GET",
          `${map[report]}/${key}`
        );

        return toolText(data);
      } catch (error) {
        return toolText({
          success: false,
          report,
          key,
          error: String(error.message || error),
        });
      }
    }
  );

  server.registerTool(
    "manager_create",
    {
      description:
        "Controlled creation of selected Manager.io accounting records. Requires exact CREATE confirmation. For invoices, resolve names first and inspect an existing form before creating. No delete capability is provided.",
      inputSchema: {
        resource: z.enum([
          "customer",
          "supplier",
          "inventory-item",
          "sales-invoice",
          "purchase-invoice",
          "receipt",
          "payment",
        ]),

        data: z.record(z.any()),

        confirmation: z
          .string()
          .describe(
            'Must be exactly "CREATE" to perform the creation'
          ),
      },
    },
    async ({
      resource,
      data,
      confirmation,
    }) => {
      if (confirmation !== "CREATE") {
        return toolText(
          'Creation cancelled. confirmation must be exactly "CREATE".'
        );
      }

      const formMap = {
        customer: "customer-form",
        supplier: "supplier-form",
        "inventory-item": "inventory-item-form",
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

        return toolText({
          success: true,
          action: "created",
          resource,
          result,
        });
      } catch (error) {
        return toolText({
          success: false,
          action: "create",
          resource,
          error: String(error.message || error),
        });
      }
    }
  );

  server.registerTool(
    "manager_get_form",
    {
      description:
        "Inspect the exact Manager.io form fields of an existing record before creating or updating another record. Use this instead of guessing Manager.io field names.",
      inputSchema: {
        resource: z.enum([
          "customer",
          "supplier",
          "inventory-item",
          "sales-invoice",
          "purchase-invoice",
          "receipt",
          "payment",
        ]),

        key: z.string().uuid(),
      },
    },
    async ({
      resource,
      key,
    }) => {
      const formMap = {
        customer: "customer-form",
        supplier: "supplier-form",
        "inventory-item": "inventory-item-form",
        "sales-invoice": "sales-invoice-form",
        "purchase-invoice": "purchase-invoice-form",
        receipt: "receipt-form",
        payment: "payment-form",
      };

      try {
        const data = await managerRequest(
          env,
          "GET",
          `${formMap[resource]}/${key}`
        );

        return toolText(data);
      } catch (error) {
        return toolText({
          success: false,
          resource,
          key,
          error: String(error.message || error),
        });
      }
    }
  );

  server.registerTool(
    "manager_update",
    {
      description:
        "Controlled update of selected Manager.io records by UUID key. Requires exact UPDATE confirmation. Do not use for mass edits. No delete capability is provided.",
      inputSchema: {
        resource: z.enum([
          "customer",
          "supplier",
          "inventory-item",
          "sales-invoice",
          "purchase-invoice",
          "receipt",
          "payment",
        ]),

        key: z.string().uuid(),

        data: z.record(z.any()),

        confirmation: z
          .string()
          .describe(
            'Must be exactly "UPDATE" to perform the update'
          ),
      },
    },
    async ({
      resource,
      key,
      data,
      confirmation,
    }) => {
      if (confirmation !== "UPDATE") {
        return toolText(
          'Update cancelled. confirmation must be exactly "UPDATE".'
        );
      }

      const formMap = {
        customer: "customer-form",
        supplier: "supplier-form",
        "inventory-item": "inventory-item-form",
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

        return toolText({
          success: true,
          action: "updated",
          resource,
          key,
          result,
        });
      } catch (error) {
        return toolText({
          success: false,
          action: "update",
          resource,
          key,
          error: String(error.message || error),
        });
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

        capabilities: [
          "broad-read",
          "inventory",
          "reports",
          "audit",
          "invoice-preparation",
          "controlled-create",
          "controlled-update",
        ],

        safety: {
          delete: false,
          adminSecurityAccess: false,
          createConfirmation: "CREATE",
          updateConfirmation: "UPDATE",
        },
      });
    }

    if (url.pathname === "/mcp") {
      return createMcpHandler(
        () => createServer(env)
      )(
        request,
        env,
        ctx
      );
    }

    return new Response(
      "Not Found",
      {
        status: 404,
      }
    );
  },
};
