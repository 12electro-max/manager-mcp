import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";

function createServer() {
  const server = new McpServer({
    name: "Manager MCP",
    version: "1.0.0",
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
      });
    }

    if (url.pathname === "/mcp") {
      return createMcpHandler(createServer)(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
};
