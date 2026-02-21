#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const WebSocket = require("ws");

// Parse args
const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
if (urlIndex === -1 || !args[urlIndex + 1]) {
    console.error("Usage: npx spoqen-mcp-connector --url <websocket-url>");
    console.error("Example: npx spoqen-mcp-connector --url wss://app.spoqen.com/agent-relay");
    process.exit(1);
}
const wsUrl = args[urlIndex + 1];

// State
let latestCanvasState = { nodes: [], connections: [] };
let isWsConnected = false;

// 1. Connect to Web App Relay
const ws = new WebSocket(wsUrl);

ws.on('open', () => {
    isWsConnected = true;
});

ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'canvas_state') {
            latestCanvasState = msg.state;
        }
    } catch (e) {
        // ignore parse errors
    }
});

ws.on('close', () => {
    isWsConnected = false;
    console.error("Lost connection to Canvas relay. Exiting...");
    process.exit(1);
});

ws.on('error', (err) => {
    console.error("WebSocket error:", err);
    process.exit(1);
});

// 2. Setup local MCP Server over Stdio
const mcpServer = new Server({
    name: "Spoqen Canvas MCP Connector",
    version: "1.0.0"
}, {
    capabilities: { tools: {} }
});

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'get_canvas_state',
                description: 'Get the current visual state of the prompt canvas, including all nodes and connections.',
                inputSchema: { type: 'object', properties: {} }
            },
            {
                name: 'add_node',
                description: 'Add a new agent or prompt node to the canvas.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        label: { type: 'string', description: 'The title of the node.' },
                        content: { type: 'string', description: 'The actual prompt or agent instruction text.' },
                        x: { type: 'number', description: 'X coordinate (approx 0-1000).' },
                        y: { type: 'number', description: 'Y coordinate (approx 0-1000).' }
                    },
                    required: ['label', 'content']
                }
            },
            {
                name: 'update_node_content',
                description: 'Update the text content of a specific node on the canvas.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        nodeId: { type: 'string', description: 'The ID of the node to update.' },
                        content: { type: 'string', description: 'The new text content.' }
                    },
                    required: ['nodeId', 'content']
                }
            },
            {
                name: 'create_connection',
                description: 'Create a flow arrow connecting two nodes together.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        fromId: { type: 'string', description: 'The source node ID.' },
                        toId: { type: 'string', description: 'The destination node ID.' },
                        label: { type: 'string', description: 'Optional label for the arrow.' }
                    },
                    required: ['fromId', 'toId']
                }
            }
        ]
    };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!isWsConnected) {
        throw new Error("Cannot execute tool: disconnected from remote canvas app.");
    }

    // Handle local reads directly from cached state
    if (name === 'get_canvas_state') {
        return {
            content: [{ type: 'text', text: JSON.stringify(latestCanvasState, null, 2) }]
        };
    }

    // Forward mutations to the cloud relay
    if (['add_node', 'update_node_content', 'create_connection'].includes(name)) {
        const actionMsg = {
            type: 'agent_action',
            action: name,
            payload: args
        };

        ws.send(JSON.stringify(actionMsg));

        return {
            content: [{ type: 'text', text: `Successfully sent ${name} action to remote canvas.` }]
        };
    }

    throw new Error(`Tool not found: ${name}`);
});

// Start Stdio server
const transport = new StdioServerTransport();
mcpServer.connect(transport).catch((err) => {
    console.error("Failed to start MCP Server:", err);
    process.exit(1);
});
