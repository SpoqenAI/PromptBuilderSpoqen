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
import { clearFlowApproval, isCurrentFlowApproved } from './state';
import type { TranscriptImportState } from './types';

interface GenerateFlowDeps {
  render: () => void;
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
    clearFlowApproval(state);

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
  if (!isCurrentFlowApproved(state)) {
    state.generationError =
      'Review and approve the generated flow before creating a project.';
    deps.render();
    return;
  }

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
  const outgoingByNode = new Map<string, Array<{ to: string; reason: string }>>();
  for (const connection of flow.connections) {
    const bucket = outgoingByNode.get(connection.from) ?? [];
    bucket.push({
      to: connection.to,
      reason: connection.reason,
    });
    outgoingByNode.set(connection.from, bucket);
  }

  const sections = flow.nodes.map((node, index) => {
    const lines = [`## ${index + 1}. ${node.label}`];
    lines.push(node.content.trim() || '(empty node content)');
    const outgoing = outgoingByNode.get(node.id) ?? [];
    if (outgoing.length === 0) {
      lines.push('Next: [end]');
    } else if (outgoing.length === 1) {
      lines.push(`Next: ${outgoing[0].to} [${outgoing[0].reason || 'Next'}]`);
    } else {
      lines.push('Branches:');
      for (const branch of outgoing) {
        lines.push(`- ${branch.to} [${branch.reason || 'Next'}]`);
      }
    }
    return lines.join('\n');
  });

  return ['# Prompt Flow Template', 'Generated from transcript flow.', '', sections.join('\n\n')].join('\n');
}
