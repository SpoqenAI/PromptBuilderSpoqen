import type { PromptNode } from '../../models';
import { uid } from '../../models';
import { resolveNodeIcon } from '../../node-icons';
import {
  getAutoNodeColor,
  readNodeColorMeta,
  withNodeColorMeta,
} from '../../node-colors';
import { router } from '../../router';
import { store } from '../../store';
import { persistTranscriptFlowArtifacts } from '../../transcript-artifacts';
import { generatePromptFromFlow } from '../../prompt-generation';
import { generateTranscriptFlow } from '../../transcript-flow';
import { DEFAULT_PROJECT_NAME } from './constants';
import { shortId } from './format';
import { buildGeneratingThoughtSequence } from './generating-thoughts';
import { buildFlowRenderState } from './layout';
import type { TranscriptImportState } from './types';

interface GenerateFlowDeps {
  render: () => void;
  onFlowGenerated?: () => void;
}

export async function generateFlow(
  state: TranscriptImportState,
  deps: GenerateFlowDeps,
): Promise<void> {
  if (state.isGenerating) return;

  if (state.transcripts.length === 0) {
    state.generationError = 'Please upload at least one transcript.';
    deps.render();
    return;
  }

  const existingGraph = state.generatedFlow
    ? {
      nodes: state.generatedFlow.nodes,
      connections: state.generatedFlow.connections,
    }
    : undefined;

  state.isGenerating = true;
  state.generatingThoughts = buildGeneratingThoughtSequence();
  state.generationError = '';
  state.persistenceMessage = null;
  state.generatedPromptMarkdown = '';
  state.promptGenerationMessage = null;
  state.processingProgress = null;
  deps.render();

  try {
    const flow = await generateTranscriptFlow({
      transcripts: state.transcripts.map((transcript) => transcript.content),
      assistantName: state.assistantName.trim() || undefined,
      userName: state.userName.trim() || undefined,
      existingGraph,
      onProgress: (processed, total, partialFlow) => {
        state.processingProgress = { processed, total };
        if (partialFlow) {
          state.generatedFlow = partialFlow;
        }
        deps.render();
      },
    });

    state.generatedFlow = flow;
    state.nodePositionOverrides = {};
    state.latestRenderedLayout = {};
    state.latestRenderedNodeSizes = {};
    state.viewport.zoom = null;
    state.viewport.panX = null;
    state.viewport.panY = null;
    state.flowRevision += 1;

    if (
      state.projectName.trim().length === 0
      || state.projectName === DEFAULT_PROJECT_NAME
    ) {
      state.projectName = flow.title;
    }

    try {
      const persisted = await persistTranscriptFlowArtifacts({
        transcript: state.transcripts.map((transcript) => transcript.content).join('\n\n---\n\n'),
        flow,
        projectName: state.projectName.trim() || flow.title || DEFAULT_PROJECT_NAME,
        transcriptSetId: state.transcriptSetId,
        metadata: {
          assistantName: state.assistantName.trim() || 'Assistant',
          userName: state.userName.trim() || 'User',
          projectModel: state.projectModel,
          nodeCountStrategy: 'ai-decides',
          transcriptCount: state.transcripts.length,
        },
      });
      state.transcriptSetId = persisted.transcriptSetId;
      store.registerTranscriptFlowDraft(
        persisted.transcriptSetId,
        flow,
        persisted.transcriptFlowId,
        state.projectName.trim() || flow.title || DEFAULT_PROJECT_NAME,
      );
      state.persistenceMessage = {
        tone: 'success',
        text: `Saved transcript artifacts (set ${shortId(persisted.transcriptSetId)}, flow ${shortId(persisted.transcriptFlowId)}).`,
      };
    } catch (persistErr) {
      state.persistenceMessage = {
        tone: 'error',
        text:
          persistErr instanceof Error
            ? persistErr.message
            : 'Failed to persist transcript artifacts.',
      };
    }
    deps.onFlowGenerated?.();
  } catch (err) {
    state.generationError =
      err instanceof Error
        ? err.message
        : 'Failed to generate flow from transcript.';
  } finally {
    state.isGenerating = false;
    deps.render();
  }
}

export async function generatePromptFromCurrentFlow(
  state: TranscriptImportState,
  deps: GenerateFlowDeps,
): Promise<void> {
  if (!state.generatedFlow || state.isGeneratingPrompt) return;

  state.isGeneratingPrompt = true;
  state.promptGenerationMessage = null;
  deps.render();

  try {
    let promptMarkdown = '';
    if (state.transcriptSetId) {
      const generated = await generatePromptFromFlow({
        transcriptSetId: state.transcriptSetId,
        mode: 'flow-template',
      });
      promptMarkdown = generated.promptMarkdown;
      if (generated.warning) {
        state.promptGenerationMessage = {
          tone: 'info',
          text: generated.warning,
        };
      }
    } else {
      promptMarkdown = assemblePromptFromGeneratedFlow(state.generatedFlow);
      state.promptGenerationMessage = {
        tone: 'info',
        text: 'Generated prompt from in-memory flow (not yet linked to a transcript set).',
      };
    }

    state.generatedPromptMarkdown = promptMarkdown;
    if (!state.promptGenerationMessage) {
      state.promptGenerationMessage = {
        tone: 'success',
        text: 'Prompt generated from flow.',
      };
    }
  } catch (err) {
    state.promptGenerationMessage = {
      tone: 'error',
      text: err instanceof Error ? err.message : 'Failed to generate prompt from flow.',
    };
  } finally {
    state.isGeneratingPrompt = false;
    deps.render();
  }
}

interface CreateProjectDeps {
  render: () => void;
  cleanupViewportAndNavigate: () => void;
}

export function createProjectFromGeneratedFlow(
  state: TranscriptImportState,
  deps: CreateProjectDeps,
): void {
  if (!state.generatedFlow) return;

  const normalizedProjectName =
    state.projectName.trim() || state.generatedFlow.title || DEFAULT_PROJECT_NAME;
  const project = store.createProject(
    normalizedProjectName,
    state.generatedFlow.summary,
    state.projectModel,
  );

  const layout = buildFlowRenderState(
    state.generatedFlow,
    state.nodePositionOverrides,
  ).layout;
  const nodeIdMap = new Map<string, string>();

  for (const [index, generatedNode] of state.generatedFlow.nodes.entries()) {
    const position = layout[generatedNode.id] ?? { x: 80, y: 80 };
    const seededColor = readNodeColorMeta(generatedNode.meta) ?? getAutoNodeColor(index);
    const promptNode: PromptNode = {
      id: uid(),
      type: generatedNode.type,
      label: generatedNode.label,
      icon: resolveNodeIcon(generatedNode.icon, generatedNode.type),
      x: position.x,
      y: position.y,
      content: generatedNode.content,
      meta: withNodeColorMeta(generatedNode.meta, seededColor),
    };

    store.addNode(project.id, promptNode);
    nodeIdMap.set(generatedNode.id, promptNode.id);
  }

  for (const connection of state.generatedFlow.connections) {
    const from = nodeIdMap.get(connection.from);
    const to = nodeIdMap.get(connection.to);
    if (!from || !to || from === to) continue;
    store.addConnection(project.id, from, to, connection.reason);
  }

  store.saveAssembledVersion(project.id, 'Initial transcript flow import');
  if (state.transcriptSetId) {
    store.linkTranscriptSetToProject(
      state.transcriptSetId,
      project.id,
      state.generatedFlow,
    );
  }
  deps.cleanupViewportAndNavigate();
  router.navigate(`/project/${project.id}`);
}

function assemblePromptFromGeneratedFlow(flow: NonNullable<TranscriptImportState['generatedFlow']>): string {
  const nodeById = new Map(flow.nodes.map((node) => [node.id, node]));
  const outgoingByNode = new Map<string, Array<{
    to: string;
    reason: string;
    isInferred: boolean;
    inferenceType: string;
  }>>();
  for (const connection of flow.connections) {
    const bucket = outgoingByNode.get(connection.from) ?? [];
    bucket.push({
      to: connection.to,
      reason: connection.reason,
      isInferred: connection.isInferred === true,
      inferenceType: typeof connection.inferenceType === 'string' ? connection.inferenceType.trim() : '',
    });
    outgoingByNode.set(connection.from, bucket);
  }

  const inboundCounts = new Map<string, number>();
  for (const node of flow.nodes) {
    inboundCounts.set(node.id, 0);
  }
  for (const connection of flow.connections) {
    inboundCounts.set(connection.to, (inboundCounts.get(connection.to) ?? 0) + 1);
  }
  const startNode = flow.nodes.find((node) => (inboundCounts.get(node.id) ?? 0) === 0) ?? flow.nodes[0];
  const personaSignal = collectSignal(flow.nodes, ['core-persona', 'tone-guidelines', 'language-model', 'style-module']);
  const missionSignal = collectSignal(flow.nodes, ['mission-objective', 'process', 'start']);

  const lines: string[] = [
    '# Voice Agent System Prompt',
    '',
    'You are a real-time voice AI agent. Treat this prompt as behavior policy, not a fixed script.',
    'Adapt naturally to user language while preserving branch logic and completion outcomes.',
    '',
    '## Identity and Persona',
    personaSignal || 'Maintain a calm, precise, and helpful tone.',
    '',
    '## Mission',
    missionSignal || 'Move the user to a successful resolution or the correct escalation path.',
    '',
    '## Operating Rules',
    '1. Start at the entry state and route by user intent.',
    '2. Ask clarifying questions when user input is ambiguous.',
    '3. Confirm key decisions and required details before advancing.',
    '4. Use escalation paths when policy or capability limits are reached.',
    '',
    '## State Machine',
    `Start state: ${startNode.label} (${startNode.id})`,
    '',
  ];

  for (const node of flow.nodes) {
    lines.push(`### ${node.label} (${node.id})`);
    lines.push(`Type: ${node.type}`);
    lines.push(`Policy: ${summarizePolicy(node.content, node.label)}`);
    const outgoing = outgoingByNode.get(node.id) ?? [];
    if (outgoing.length === 0) {
      lines.push('Next: [end]');
    } else {
      lines.push('Transitions:');
      for (const edge of outgoing) {
        const targetLabel = nodeById.get(edge.to)?.label ?? edge.to;
        const inferredSuffix = edge.isInferred
          ? ` (inferred${edge.inferenceType ? `:${edge.inferenceType}` : ''})`
          : '';
        lines.push(`- If "${edge.reason || 'Next'}" then go to ${targetLabel} (${edge.to})${inferredSuffix}.`);
      }
    }
    lines.push('');
  }

  const branchNodes = flow.nodes.filter((node) => (outgoingByNode.get(node.id) ?? []).length > 1);
  lines.push('## Branch Handling');
  if (branchNodes.length === 0) {
    lines.push('Single-path interaction. Close once completion criteria are met.');
  } else {
    for (const node of branchNodes) {
      const conditions = (outgoingByNode.get(node.id) ?? [])
        .map((edge) => edge.reason || 'Next')
        .join(', ');
      lines.push(`- At "${node.label}" evaluate: ${conditions}.`);
    }
  }
  lines.push('');
  lines.push('## Escalation and Recovery');
  lines.push('Escalate when requested, when blocked by policy, or after repeated failed attempts.');
  lines.push('If the user goes off-path, summarize the current goal and guide them back to a valid state.');
  lines.push('');
  lines.push('## Voice Style');
  lines.push('Sound natural, concise, and action-oriented. Avoid robotic repetition.');

  return lines.join('\n').trim();
}

function collectSignal(
  nodes: NonNullable<TranscriptImportState['generatedFlow']>['nodes'],
  preferredTypes: string[],
): string {
  return nodes
    .filter((node) => preferredTypes.includes(node.type))
    .slice(0, 3)
    .map((node) => summarizePolicy(node.content, node.label))
    .filter((text) => text.length > 0)
    .join(' ');
}

function summarizePolicy(content: string, fallback: string): string {
  const normalized = content
    .replace(/\s+/g, ' ')
    .replace(/\b(assistant|agent|user)\s*:/gi, '')
    .trim();
  if (!normalized) return fallback;
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 237).trim()}...`;
}
