import type { Plugin } from 'vite';
import type { WebSocketServer as WebSocketServerType, WebSocket as WebSocketType } from 'ws';

// Global state for canvas connected from frontend
let currentCanvasState: any = { nodes: [], connections: [] };

// Clients that want real-time canvas updates (the web browser app)
const canvasClients = new Set<WebSocketType>();

// Agent/connector clients (the local MCP CLI connector connecting to the cloud)
const agentClients = new Set<WebSocketType>();

export function mcpRelayPlugin(): Plugin {
    return {
        name: 'vite-plugin-mcp-relay',
        async configureServer(server) {
            if (!server.httpServer) return;

            const { WebSocketServer } = await import('ws');
            const wss = new WebSocketServer({ noServer: true });

            server.httpServer.on('upgrade', (request, socket, head) => {
                if (request.url?.includes('/vite-hmr')) return;

                const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
                if (pathname === '/canvas-sync' || pathname === '/agent-relay') {
                    wss.handleUpgrade(request, socket, head, (ws) => {
                        wss.emit('connection', ws, request);
                    });
                }
            });

            wss.on('connection', (ws, request) => {
                const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

                if (pathname === '/canvas-sync') {
                    // --- Web Browser Canvas Connection ---
                    canvasClients.add(ws);

                    ws.on('message', (msg) => {
                        try {
                            const parsed = JSON.parse(msg.toString());
                            if (parsed.type === 'update_state') {
                                currentCanvasState = parsed.state;
                                // Broadcast updated canvas state to any connected CLI agents
                                for (const agent of agentClients) {
                                    // Use literal constant instead of the enum to avoid runtime require err
                                    if (agent.readyState === 1 /* WebSocket.OPEN */) {
                                        agent.send(JSON.stringify({ type: 'canvas_state', state: currentCanvasState }));
                                    }
                                }
                            }
                        } catch (e) {
                            console.error('Error parsing canvas sync message', e);
                        }
                    });

                    ws.on('close', () => canvasClients.delete(ws));

                } else if (pathname === '/agent-relay') {
                    // --- Local CLI Agent Connector ---
                    agentClients.add(ws);

                    // Instantly send current state upon connection
                    if (ws.readyState === 1 /* WebSocket.OPEN */) {
                        ws.send(JSON.stringify({ type: 'canvas_state', state: currentCanvasState }));
                    }

                    ws.on('message', (msg) => {
                        try {
                            const parsed = JSON.parse(msg.toString());
                            // Agent is requesting a canvas mutation tool call
                            if (parsed.type === 'agent_action') {
                                for (const client of canvasClients) {
                                    if (client.readyState === 1 /* WebSocket.OPEN */) {
                                        client.send(msg.toString());
                                    }
                                }
                            }
                        } catch (e) {
                            console.error('Error parsing agent relay message', e);
                        }
                    });

                    ws.on('close', () => agentClients.delete(ws));
                }
            });
        }
    };
}
