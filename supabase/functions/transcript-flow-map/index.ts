import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, requireUser } from '../_shared/supabase.ts';
import { runGeminiAgentLoop } from '../_shared/gemini-provider.ts';
import type { GeminiFunctionCall, GeminiTool } from '../_shared/gemini-provider.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlowNodeType = 'start' | 'end' | 'process' | 'decision';

interface FlowNode {
  id: string;
  label: string;
  type: FlowNodeType;
}

interface FlowConnection {
  from: string;
  to: string;
  label: string;
}

interface DiagramState {
  nodes: FlowNode[];
  connections: FlowConnection[];
  nextId: number;
}

interface RequestBody {
  transcript?: unknown;
  transcripts?: unknown;
  assistantName?: unknown;
  userName?: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_TRANSCRIPT_LENGTH = 20;
const MAX_TRANSCRIPT_LENGTH = 120_000;
const VALID_NODE_TYPES: readonly FlowNodeType[] = ['start', 'end', 'process', 'decision'];
const MAX_DEPTH_EXCL_TERMINALS = 7;

// ---------------------------------------------------------------------------
// Diagram State Manager
// ---------------------------------------------------------------------------

function createDiagramState(): DiagramState {
  return { nodes: [], connections: [], nextId: 1 };
}

function addNode(state: DiagramState, label: string, type: FlowNodeType): { node_id: string } {
  const nodeType = VALID_NODE_TYPES.includes(type) ? type : 'process';

  // Enforce: only one start node
  if (nodeType === 'start' && state.nodes.some((n) => n.type === 'start')) {
    return { node_id: state.nodes.find((n) => n.type === 'start')!.id };
  }

  const id = `n${state.nextId++}`;
  state.nodes.push({ id, label: label.trim() || `Node ${id}`, type: nodeType });
  return { node_id: id };
}

function deleteNode(state: DiagramState, nodeId: string): { success: boolean; message: string } {
  const index = state.nodes.findIndex((n) => n.id === nodeId);
  if (index === -1) return { success: false, message: `Node "${nodeId}" not found.` };

  state.nodes.splice(index, 1);
  state.connections = state.connections.filter((c) => c.from !== nodeId && c.to !== nodeId);
  return { success: true, message: `Deleted node "${nodeId}" and its connections.` };
}

function connectNodes(
  state: DiagramState,
  sourceId: string,
  targetId: string,
  label: string,
): { success: boolean; message: string } {
  if (sourceId === targetId) {
    return { success: false, message: 'Cannot connect a node to itself.' };
  }
  if (!state.nodes.some((n) => n.id === sourceId)) {
    return { success: false, message: `Source node "${sourceId}" not found.` };
  }
  if (!state.nodes.some((n) => n.id === targetId)) {
    return { success: false, message: `Target node "${targetId}" not found.` };
  }
  const exists = state.connections.some((c) => c.from === sourceId && c.to === targetId);
  if (exists) {
    return { success: false, message: `Connection from "${sourceId}" to "${targetId}" already exists.` };
  }

  state.connections.push({ from: sourceId, to: targetId, label: (label ?? '').trim() });
  return { success: true, message: `Connected "${sourceId}" → "${targetId}" with label "${label}".` };
}

function disconnectNodes(
  state: DiagramState,
  sourceId: string,
  targetId: string,
): { success: boolean; message: string } {
  const index = state.connections.findIndex((c) => c.from === sourceId && c.to === targetId);
  if (index === -1) {
    return { success: false, message: `No connection from "${sourceId}" to "${targetId}" found.` };
  }
  state.connections.splice(index, 1);
  return { success: true, message: `Disconnected "${sourceId}" → "${targetId}".` };
}

function editNode(
  state: DiagramState,
  nodeId: string,
  newLabel: string,
): { success: boolean; message: string } {
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) return { success: false, message: `Node "${nodeId}" not found.` };
  node.label = newLabel.trim() || node.label;
  return { success: true, message: `Updated node "${nodeId}" label to "${node.label}".` };
}

function getCurrentDiagram(state: DiagramState): { nodes: FlowNode[]; connections: FlowConnection[] } {
  return { nodes: [...state.nodes], connections: [...state.connections] };
}

function mergeNodes(
  state: DiagramState,
  nodeId1: string,
  nodeId2: string,
): { success: boolean; message: string; merged_id?: string } {
  const node1 = state.nodes.find((n) => n.id === nodeId1);
  const node2 = state.nodes.find((n) => n.id === nodeId2);
  if (!node1 || !node2) {
    return { success: false, message: `One or both nodes not found.` };
  }
  if (node1.type !== node2.type) {
    return { success: false, message: `Cannot merge nodes of different types (${node1.type} vs ${node2.type}).` };
  }

  // Keep node1, rewire node2's connections to node1, delete node2
  for (const conn of state.connections) {
    if (conn.from === nodeId2) conn.from = nodeId1;
    if (conn.to === nodeId2) conn.to = nodeId1;
  }
  // Remove self-loops and duplicates
  state.connections = state.connections.filter((c) => c.from !== c.to);
  const seen = new Set<string>();
  state.connections = state.connections.filter((c) => {
    const key = `${c.from}->${c.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  state.nodes = state.nodes.filter((n) => n.id !== nodeId2);
  return { success: true, message: `Merged "${nodeId2}" into "${nodeId1}".`, merged_id: nodeId1 };
}

function validateDiagram(state: DiagramState): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check start node
  const startNodes = state.nodes.filter((n) => n.type === 'start');
  if (startNodes.length === 0) issues.push('Missing start node.');
  if (startNodes.length > 1) issues.push(`Multiple start nodes found (${startNodes.length}).`);

  // Check end nodes
  const endNodes = state.nodes.filter((n) => n.type === 'end');
  if (endNodes.length === 0) issues.push('Missing end node.');

  // Check orphan nodes (no connections in or out, excluding start/end with only one direction)
  const connectedIds = new Set<string>();
  for (const c of state.connections) {
    connectedIds.add(c.from);
    connectedIds.add(c.to);
  }
  for (const node of state.nodes) {
    if (state.nodes.length <= 1) break;
    if (!connectedIds.has(node.id)) {
      issues.push(`Node "${node.id}" (${node.label}) is orphaned — no connections.`);
    }
  }

  // Check decisions have >= 2 outgoing
  for (const node of state.nodes) {
    if (node.type !== 'decision') continue;
    const outgoing = state.connections.filter((c) => c.from === node.id);
    if (outgoing.length < 2) {
      issues.push(`Decision node "${node.id}" (${node.label}) has ${outgoing.length} outgoing branch(es), needs ≥ 2.`);
    }
  }

  // Check max depth (BFS from start, excluding start/end terminals)
  if (startNodes.length === 1) {
    const depth = computeMaxDepth(state, startNodes[0].id);
    if (depth > MAX_DEPTH_EXCL_TERMINALS) {
      issues.push(`Max depth is ${depth}, exceeds limit of ${MAX_DEPTH_EXCL_TERMINALS} (excluding start/end).`);
    }
  }

  // Check dangling non-end nodes (no outgoing)
  for (const node of state.nodes) {
    if (node.type === 'end') continue;
    const hasOutgoing = state.connections.some((c) => c.from === node.id);
    if (!hasOutgoing && state.nodes.length > 1) {
      issues.push(`Node "${node.id}" (${node.label}) has no outgoing connections but is not an end node.`);
    }
  }

  return { valid: issues.length === 0, issues };
}

function computeMaxDepth(state: DiagramState, startId: string): number {
  const outgoing = new Map<string, string[]>();
  for (const node of state.nodes) outgoing.set(node.id, []);
  for (const conn of state.connections) {
    outgoing.get(conn.from)?.push(conn.to);
  }

  const nodeTypeMap = new Map(state.nodes.map((n) => [n.id, n.type]));
  const depths = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  depths.set(startId, 0);

  let maxNonTerminalDepth = 0;

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const nodeType = nodeTypeMap.get(id);
    if (nodeType !== 'start' && nodeType !== 'end') {
      maxNonTerminalDepth = Math.max(maxNonTerminalDepth, depth);
    }

    for (const neighbor of outgoing.get(id) ?? []) {
      const nextDepth = depth + 1;
      if (!depths.has(neighbor) || depths.get(neighbor)! > nextDepth) {
        depths.set(neighbor, nextDepth);
        queue.push({ id: neighbor, depth: nextDepth });
      }
    }
  }

  return maxNonTerminalDepth;
}

// ---------------------------------------------------------------------------
// Tool Declarations for Gemini
// ---------------------------------------------------------------------------

const TOOL_DECLARATIONS: GeminiTool[] = [
  {
    name: 'add_node',
    description: 'Add a new node to the flowchart. Types: "start" (oval), "end" (oval), "process" (rectangle), "decision" (diamond). Only one start node is allowed.',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Short label for the node (3-8 words).' },
        type: { type: 'string', enum: ['start', 'end', 'process', 'decision'], description: 'Node type.' },
      },
      required: ['label', 'type'],
    },
  },
  {
    name: 'delete_node',
    description: 'Remove a node and all its connections from the flowchart.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'ID of the node to delete.' },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'connect_nodes',
    description: 'Create a directed edge (arrow) between two nodes. For decision nodes, the label should be the branch condition (e.g. "Yes", "No", "New Patient").',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'ID of the source node.' },
        target_id: { type: 'string', description: 'ID of the target node.' },
        label: { type: 'string', description: 'Edge label (branch condition or transition description). Use "" for simple sequential flow.' },
      },
      required: ['source_id', 'target_id', 'label'],
    },
  },
  {
    name: 'disconnect_nodes',
    description: 'Remove a directed edge between two nodes.',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: 'ID of the source node.' },
        target_id: { type: 'string', description: 'ID of the target node.' },
      },
      required: ['source_id', 'target_id'],
    },
  },
  {
    name: 'edit_node',
    description: 'Change the label of an existing node.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'ID of the node to edit.' },
        new_label: { type: 'string', description: 'New label for the node.' },
      },
      required: ['node_id', 'new_label'],
    },
  },
  {
    name: 'get_current_diagram',
    description: 'Returns the current state of the diagram — all nodes and connections. Use this to review what you have built so far.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'merge_nodes',
    description: 'Merge two nodes of the same type into one. The second node is removed and its connections are rewired to the first node.',
    parameters: {
      type: 'object',
      properties: {
        node_id_1: { type: 'string', description: 'ID of the node to keep.' },
        node_id_2: { type: 'string', description: 'ID of the node to merge into node_id_1 (will be deleted).' },
      },
      required: ['node_id_1', 'node_id_2'],
    },
  },
  {
    name: 'validate_diagram',
    description: 'Check the diagram for structural issues: missing start/end, orphan nodes, decision nodes with < 2 branches, depth exceeding 7 levels (excluding start/end). Always call this when you believe you are done building.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Tool Executor
// ---------------------------------------------------------------------------

function executeToolCall(state: DiagramState, call: GeminiFunctionCall): Record<string, unknown> {
  const args = call.args;

  switch (call.name) {
    case 'add_node':
      return addNode(state, String(args.label ?? ''), String(args.type ?? 'process') as FlowNodeType);

    case 'delete_node':
      return deleteNode(state, String(args.node_id ?? ''));

    case 'connect_nodes':
      return connectNodes(
        state,
        String(args.source_id ?? ''),
        String(args.target_id ?? ''),
        String(args.label ?? ''),
      );

    case 'disconnect_nodes':
      return disconnectNodes(state, String(args.source_id ?? ''), String(args.target_id ?? ''));

    case 'edit_node':
      return editNode(state, String(args.node_id ?? ''), String(args.new_label ?? ''));

    case 'get_current_diagram':
      return getCurrentDiagram(state);

    case 'merge_nodes':
      return mergeNodes(state, String(args.node_id_1 ?? ''), String(args.node_id_2 ?? ''));

    case 'validate_diagram':
      return validateDiagram(state);

    default:
      return { error: `Unknown tool: ${call.name}` };
  }
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(assistantName: string, userName: string): string {
  return [
    'You are a flowchart architect. Your job is to read call center / assistant transcripts and build a high-level process flow diagram using the tools provided.',
    '',
    'FLOWCHART CONVENTIONS (INDUSTRY STANDARD):',
    '- Ovals → start and end nodes only.',
    '- Rectangles → process/action steps (e.g. "Verify Identity", "Schedule Appointment").',
    '- Diamonds → decision/branch points. Label should be a question or condition.',
    '- Arrows → directed flow between nodes. Branch labels like "Yes", "No", "New Patient" must be clear and concise.',
    '',
    'RULES YOU MUST FOLLOW:',
    '1. Start with exactly ONE start node (type: "start").',
    '2. End with one or more end nodes (type: "end").',
    '3. Keep the diagram HIGH-LEVEL: 6-12 nodes total. Capture major phases, not individual utterances.',
    '4. Every decision node MUST have at least 2 outgoing branches with descriptive labels.',
    '5. Maximum depth of 7 levels (not counting start and end nodes).',
    '6. No orphan nodes — every node must be connected.',
    '7. Node labels should be generic process descriptions (3-8 words), not verbatim transcript quotes.',
    '8. Use "process" for action steps and "decision" for any branching logic.',
    '',
    'WORKFLOW:',
    '1. Read the transcript carefully.',
    '2. Identify the major phases and decision points.',
    '3. Use add_node to create nodes, then connect_nodes to wire them up.',
    '4. When done, call validate_diagram to check your work.',
    '5. Fix any issues reported by validate_diagram.',
    '6. Once validation passes, respond with a brief title and summary of the flow.',
    '',
    `Speaker labels in the transcript: Assistant = "${assistantName}", User = "${userName}".`,
  ].join('\n');
}

function buildSystemPromptNormalized(assistantName: string, userName: string): string {
  return [
    'You are a flowchart architect. Your job is to read call center or assistant transcripts and build a high-level process flow diagram using the tools provided.',
    '',
    'FLOWCHART CONVENTIONS (INDUSTRY STANDARD):',
    '- Ovals -> start and end nodes only.',
    '- Rectangles -> process or action steps (for example "Verify Identity" or "Schedule Appointment").',
    '- Diamonds -> decision or branch points. The label should be a question or condition.',
    '- Arrows -> directed flow between nodes. Branch labels like "Yes", "No", "Unclear", and "New Patient" must be clear and concise.',
    '',
    'RULES YOU MUST FOLLOW:',
    '1. Start with exactly one start node (type: "start").',
    '2. End with one or more end nodes (type: "end").',
    '3. Keep the diagram high-level and encompassing. Capture major phases, not individual utterances.',
    '4. Every decision node must have at least 2 outgoing branches with descriptive labels.',
    '5. Maximum depth is 7 non-terminal layers. This is a layer limit, not a total node limit. Including start and end, the longest path can be at most 9 layers.',
    '6. No orphan nodes. Every node must be connected.',
    '7. Node labels should be generic process descriptions with roughly 3 to 8 words, not verbatim transcript quotes.',
    '8. Use "process" for action steps and "decision" for any branching logic.',
    '9. Prefer a professional process-flow structure with clear phases, readable branch labels, and no unnecessary micro-steps.',
    '',
    'WORKFLOW:',
    '1. Read the transcript carefully.',
    '2. Identify the major phases and decision points.',
    '3. Use add_node to create nodes, then connect_nodes to wire them up.',
    '4. When done, call validate_diagram to check your work.',
    '5. Fix any issues reported by validate_diagram.',
    '6. Once validation passes, respond with a brief title and summary of the flow.',
    '',
    `Speaker labels in the transcript: Assistant = "${assistantName}", User = "${userName}".`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Request Handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed.' }, req);
  }

  try {
    const body = await parseJson<RequestBody>(req);
    const transcript = normalizeTranscript(body);
    const assistantName = normalizeSpeakerName(body.assistantName, 'Assistant');
    const userName = normalizeSpeakerName(body.userName, 'User');

    const adminClient = createAdminClient();
    await requireUser(req, adminClient);

    console.log(JSON.stringify({
      event: 'transcript-flow-map:agent-start',
      transcriptLength: transcript.length,
    }));

    // Create in-memory diagram state
    const diagramState = createDiagramState();

    // Run the Gemini agent loop
    const result = await runGeminiAgentLoop({
      systemPrompt: buildSystemPromptNormalized(assistantName, userName),
      userMessage: [
        'Build a high-level flowchart for the following call transcript.',
        'Use the tools to construct the diagram step by step.',
        'When you are done building, call validate_diagram to check your work, fix any issues, then provide a brief title and summary.',
        '',
        '=== TRANSCRIPT ===',
        transcript,
      ].join('\n'),
      tools: TOOL_DECLARATIONS,
      executeTool: (call) => executeToolCall(diagramState, call),
      onIteration: (iteration, calls) => {
        console.log(JSON.stringify({
          event: 'transcript-flow-map:agent-iteration',
          iteration,
          toolCalls: calls.map((c) => c.name),
        }));
      },
    });

    console.log(JSON.stringify({
      event: 'transcript-flow-map:agent-complete',
      iterations: result.iterations,
      totalToolCalls: result.toolCallLog.length,
      nodeCount: diagramState.nodes.length,
      connectionCount: diagramState.connections.length,
    }));

    // Extract title and summary from final text
    const title = extractTitle(result.text) || 'Call Flow Diagram';
    const summary = extractSummary(result.text) || 'Generated from transcript analysis.';

    // Final validation
    const validation = validateDiagram(diagramState);

    return jsonResponse(200, {
      title,
      summary,
      nodes: diagramState.nodes,
      connections: diagramState.connections,
      model: 'gemini-2.5-flash-lite',
      iterations: result.iterations,
      toolCalls: result.toolCallLog.length,
      warning: validation.valid ? null : `Validation: ${validation.issues.join('; ')}`,
    }, req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const normalized = message.toLowerCase();
    const status = normalized.includes('unauthorized') ? 401 : 400;
    return jsonResponse(status, { error: message }, req);
  }
});

// ---------------------------------------------------------------------------
// Input Normalization
// ---------------------------------------------------------------------------

async function parseJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

function normalizeTranscript(body: RequestBody): string {
  let raw: string;

  if (Array.isArray(body.transcripts) && body.transcripts.length > 0) {
    const parts: string[] = [];
    for (let i = 0; i < body.transcripts.length; i++) {
      const item = body.transcripts[i];
      if (typeof item !== 'string') continue;
      const cleaned = item.replace(/\r\n?/g, '\n').trim();
      if (cleaned.length < MIN_TRANSCRIPT_LENGTH) continue;
      parts.push(`=== TRANSCRIPT ${i + 1} of ${body.transcripts.length} ===\n${cleaned}`);
    }
    if (parts.length === 0) {
      throw new Error(`At least one transcript must be ${MIN_TRANSCRIPT_LENGTH} characters.`);
    }
    raw = parts.join('\n\n---\n\n');
  } else if (typeof body.transcript === 'string') {
    raw = body.transcript.replace(/\r\n?/g, '\n').trim();
  } else {
    throw new Error('Transcript is required.');
  }

  if (raw.length < MIN_TRANSCRIPT_LENGTH) {
    throw new Error(`Transcript must be at least ${MIN_TRANSCRIPT_LENGTH} characters.`);
  }

  if (raw.length > MAX_TRANSCRIPT_LENGTH) {
    raw = raw.slice(0, MAX_TRANSCRIPT_LENGTH);
  }

  return raw;
}

function normalizeSpeakerName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 40);
}

// ---------------------------------------------------------------------------
// Result Extraction
// ---------------------------------------------------------------------------

function extractTitle(text: string): string | null {
  // Try to find "Title: ..." or "# ..." patterns
  const titleMatch = text.match(/(?:title\s*[:=]\s*|^#\s+)(.+)/im);
  if (titleMatch) return titleMatch[1].trim().replace(/^["']|["']$/g, '');

  // Use the first non-empty line as title
  const firstLine = text.split('\n').find((l) => l.trim().length > 0);
  if (firstLine && firstLine.trim().length <= 80) return firstLine.trim();

  return null;
}

function extractSummary(text: string): string | null {
  // Try "Summary: ..." pattern
  const summaryMatch = text.match(/summary\s*[:=]\s*(.+)/im);
  if (summaryMatch) return summaryMatch[1].trim();

  // Use the full text if short enough
  if (text.trim().length > 0 && text.trim().length <= 500) return text.trim();

  return null;
}
