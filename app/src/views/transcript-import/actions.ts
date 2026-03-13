import { store } from '../../store';
import { uid } from '../../models';
import type { PromptNode, NodeType } from '../../models';
import { resolveNodeIcon } from '../../node-icons';
import {
  generateTranscriptFlow,
} from '../../transcript-flow';
import type { TranscriptFlowResult, TranscriptFlowNode } from '../../transcript-flow';
import type { TranscriptImportState } from './types';

// ---------------------------------------------------------------------------
// Generate Flow (calls the Gemini agent edge function)
// ---------------------------------------------------------------------------

interface GenerateFlowCallbacks {
  render: () => void;
  onFlowGenerated: () => Promise<void> | void;
}

export async function generateFlow(
  state: TranscriptImportState,
  callbacks: GenerateFlowCallbacks,
): Promise<void> {
  if (state.transcripts.length === 0) {
    state.generationError = 'Add at least one transcript before generating.';
    callbacks.render();
    return;
  }
  if (state.isGenerating) return;

  state.isGenerating = true;
  state.generationError = '';
  state.validationWarnings = [];
  state.persistenceMessage = null;
  state.generatedPromptMarkdown = '';
  state.promptGenerationMessage = null;
  callbacks.render();

  try {
    const result = await generateTranscriptFlow({
      transcripts: state.transcripts.map((t) => t.content),
      assistantName: state.assistantName.trim() || 'Assistant',
      userName: state.userName.trim() || 'User',
    });

    state.generatedFlow = result;
    state.flowRevision += 1;
    state.nodePositionOverrides = {};
    state.latestRenderedLayout = {};
    state.latestRenderedNodeSizes = {};
    state.selectedConnectionIndex = null;

    if (result.warning) {
      state.validationWarnings = [result.warning];
    }

    if (!state.transcriptSetId) {
      state.transcriptSetId = await store.ensureTranscriptImportWorkspace(
        state.projectName.trim() || result.title || 'Transcript Flow',
        result.summary || 'Editable transcript flow workspace.',
      );
    }

    store.registerTranscriptFlowDraft(
      state.transcriptSetId,
      result,
      uid(),
      state.projectName.trim() || result.title || 'Transcript Flow',
    );

    state.persistenceMessage = {
      tone: 'success',
      text: `Flow generated: ${result.nodes.length} nodes, ${result.connections.length} connections (${result.iterations} iterations, ${result.toolCalls} tool calls).`,
    };

    await callbacks.onFlowGenerated();
  } catch (err) {
    state.generationError = err instanceof Error ? err.message : 'Flow generation failed.';
  } finally {
    state.isGenerating = false;
    callbacks.render();
  }
}

// ---------------------------------------------------------------------------
// Generate Prompt from Flow
// ---------------------------------------------------------------------------

interface PromptCallbacks {
  render: () => void;
}

export async function generatePromptFromCurrentFlow(
  state: TranscriptImportState,
  callbacks: PromptCallbacks,
): Promise<void> {
  const flow = state.generatedFlow;
  if (!flow || flow.nodes.length === 0) {
    state.promptGenerationMessage = {
      tone: 'error',
      text: 'No flow to generate a prompt from.',
    };
    callbacks.render();
    return;
  }

  state.isGeneratingPrompt = true;
  state.promptGenerationMessage = null;
  callbacks.render();

  try {
    const markdown = assemblePromptFromFlow(flow, state.assistantName, state.userName);
    state.generatedPromptMarkdown = markdown;
    state.promptGenerationMessage = {
      tone: 'success',
      text: 'Prompt generated from current flow.',
    };
  } catch (err) {
    state.promptGenerationMessage = {
      tone: 'error',
      text: err instanceof Error ? err.message : 'Failed to generate prompt.',
    };
  } finally {
    state.isGeneratingPrompt = false;
    callbacks.render();
  }
}

// ---------------------------------------------------------------------------
// Create Canvas Project from Flow
// ---------------------------------------------------------------------------

interface CreateProjectCallbacks {
  render: () => void;
  cleanupViewportAndNavigate: () => void;
}

export function createProjectFromGeneratedFlow(
  state: TranscriptImportState,
  callbacks: CreateProjectCallbacks,
): void {
  const flow = state.generatedFlow;
  if (!flow || flow.nodes.length === 0) {
    state.persistenceMessage = {
      tone: 'error',
      text: 'No flow to create a project from.',
    };
    callbacks.render();
    return;
  }

  try {
    const projectName = state.projectName.trim() || flow.title || 'Imported Flow';
    const projectModel = state.projectModel.trim() || 'GPT-4o';

    const project = store.createProject(
      projectName,
      flow.summary || 'Generated from transcript flow.',
      projectModel,
    );

    // Add nodes to the project
    for (const flowNode of flow.nodes) {
      const canvasType = mapFlowTypeToCanvasType(flowNode.type);
      const canvasIcon = mapFlowTypeToIcon(flowNode.type);
      const promptNode: PromptNode = {
        id: flowNode.id,
        type: canvasType,
        label: flowNode.label,
        icon: resolveNodeIcon(canvasIcon, canvasType),
        x: 0,
        y: 0,
        content: flowNode.label,
        meta: {},
      };
      store.addNode(project.id, promptNode);
    }

    // Add connections
    for (const conn of flow.connections) {
      store.addConnection(project.id, conn.from, conn.to, conn.label || '');
    }

    // Link transcript set to the project
    if (state.transcriptSetId) {
      store.linkTranscriptSetToProject(state.transcriptSetId, project.id, flow);
    }

    state.persistenceMessage = {
      tone: 'success',
      text: `Canvas project "${projectName}" created and linked.`,
    };
    callbacks.render();
  } catch (err) {
    state.persistenceMessage = {
      tone: 'error',
      text: err instanceof Error ? err.message : 'Failed to create project.',
    };
    callbacks.render();
  }
}

// ---------------------------------------------------------------------------
// Prompt Assembly
// ---------------------------------------------------------------------------

function assemblePromptFromFlow(
  flow: TranscriptFlowResult,
  assistantName: string,
  userName: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${flow.title || 'Call Flow'}`);
  lines.push('');
  if (flow.summary) {
    lines.push(flow.summary);
    lines.push('');
  }

  lines.push('## Process Flow');
  lines.push('');

  const nodeMap = new Map(flow.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, typeof flow.connections>();
  for (const conn of flow.connections) {
    const list = outgoing.get(conn.from) ?? [];
    list.push(conn);
    outgoing.set(conn.from, list);
  }

  // Walk from start
  const startNode = flow.nodes.find((n) => n.type === 'start');
  const visited = new Set<string>();
  const queue: string[] = [];

  if (startNode) {
    queue.push(startNode.id);
  } else if (flow.nodes.length > 0) {
    queue.push(flow.nodes[0].id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const node = nodeMap.get(id);
    if (!node) continue;

    const typeLabel = node.type === 'decision' ? '◇' : node.type === 'start' || node.type === 'end' ? '⬮' : '▬';
    lines.push(`### ${typeLabel} ${node.label}`);

    const edges = outgoing.get(id) ?? [];
    if (edges.length > 0) {
      for (const edge of edges) {
        const target = nodeMap.get(edge.to);
        const targetLabel = target?.label ?? edge.to;
        const label = edge.label ? ` (${edge.label})` : '';
        lines.push(`- → ${targetLabel}${label}`);
        if (!visited.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }
    lines.push('');
  }

  // Append any unvisited nodes
  for (const node of flow.nodes) {
    if (visited.has(node.id)) continue;
    lines.push(`### ${node.label}`);
    lines.push('*(Not connected to main flow)*');
    lines.push('');
  }

  lines.push(`---`);
  lines.push(`Assistant: ${assistantName} | User: ${userName}`);
  lines.push(`Model: ${flow.model} | Generated with ${flow.iterations} iterations`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapFlowTypeToCanvasType(type: string): NodeType {
  switch (type) {
    case 'start': return 'custom';
    case 'end': return 'termination';
    case 'decision': return 'logic-branch';
    case 'process': return 'custom';
    default: return 'custom';
  }
}

function mapFlowTypeToIcon(type: string): string {
  switch (type) {
    case 'start': return 'play_circle';
    case 'end': return 'stop_circle';
    case 'decision': return 'call_split';
    case 'process': return 'settings';
    default: return 'circle';
  }
}
