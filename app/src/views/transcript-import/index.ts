import { loadTranscriptWorkspace, upsertTranscriptWorkspaceFlow } from '../../transcript-workspace';
import { router } from '../../router';
import { store } from '../../store';
import { wireThemeToggle } from '../../theme';
import { preserveScrollDuringRender } from '../../view-state';
import { getSubscriptionLimits, recordFeatureUsage } from '../../subscription-limits';
import { customAlert } from '../../dialogs';
import {
  createProjectFromGeneratedFlow,
  generateFlow,
  generatePromptFromCurrentFlow,
} from './actions';
import { wireTranscriptImportEvents } from './events';
import { buildFlowRenderState, cloneLayout } from './layout';
import { openNodeEditorModal } from './node-editor-modal';
import { createTranscriptImportState } from './state';
import { renderTranscriptImportShell } from './template';
import { wireFlowViewport } from './viewport';

const WORKSPACE_AUTOSAVE_DEBOUNCE_MS = 800;

export function renderTranscriptImport(
  container: HTMLElement,
  transcriptSetIdParam?: string,
): void {
  const state = createTranscriptImportState();
  const suppressNextNodeClick = { value: false };
  let cleanupEventBindings: (() => void) | null = null;
  let cleanupFlowViewport: (() => void) | null = null;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let autosaveSerial = 0;
  let workspaceSaveInFlight = false;
  let workspaceSaveQueued = false;

  const pinCurrentNodePositions = (): void => {
    const flow = state.generatedFlow;
    if (!flow) return;

    const activeNodeIds = new Set(flow.nodes.map((node) => node.id));
    for (const nodeId of Object.keys(state.nodePositionOverrides)) {
      if (!activeNodeIds.has(nodeId)) {
        delete state.nodePositionOverrides[nodeId];
      }
    }

    for (const node of flow.nodes) {
      if (state.nodePositionOverrides[node.id]) continue;
      const currentPosition = state.latestRenderedLayout[node.id];
      if (!currentPosition) continue;
      state.nodePositionOverrides[node.id] = {
        x: currentPosition.x,
        y: currentPosition.y,
      };
    }
  };

  const routeTranscriptSetId = normalizeOptionalId(transcriptSetIdParam);
  if (routeTranscriptSetId) {
    state.transcriptSetId = routeTranscriptSetId;
    state.isHydratingWorkspace = true;
  }

  const clearAutosaveTimer = (): void => {
    if (!autosaveTimer) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  };

  const cleanupViewport = (): void => {
    cleanupEventBindings?.();
    cleanupEventBindings = null;
    cleanupFlowViewport?.();
    cleanupFlowViewport = null;
  };

  const cleanup = (): void => {
    clearAutosaveTimer();
    cleanupViewport();
    autosaveSerial += 1;
    workspaceSaveInFlight = false;
    workspaceSaveQueued = false;
  };

  const render = (): void => {
    cleanupViewport();
    if (
      state.selectedConnectionIndex !== null
      && (
        !state.generatedFlow
        || state.selectedConnectionIndex < 0
        || state.selectedConnectionIndex >= state.generatedFlow.connections.length
      )
    ) {
      state.selectedConnectionIndex = null;
    }

    const canGenerate =
      state.transcripts.length > 0 &&
      !state.isGenerating &&
      !state.isHydratingWorkspace;
    const linkedProjectId = resolveLinkedProjectId(state.transcriptSetId);
    const flowRenderState = state.generatedFlow
      ? buildFlowRenderState(state.generatedFlow, state.nodePositionOverrides)
      : null;

    state.latestRenderedLayout = flowRenderState
      ? cloneLayout(flowRenderState.layout)
      : {};
    state.latestRenderedNodeSizes = flowRenderState
      ? { ...flowRenderState.nodeSizes }
      : {};

    preserveScrollDuringRender(container, () => {
      container.innerHTML = renderTranscriptImportShell({
        baseUrl: import.meta.env.BASE_URL,
        projectName: state.projectName,
        projectModel: state.projectModel,
        linkedProjectId,
        assistantName: state.assistantName,
        userName: state.userName,
        transcripts: state.transcripts,
        generationError: state.generationError,
        validationWarnings: state.validationWarnings,
        persistenceMessage: state.persistenceMessage,
        generatedPromptMarkdown: state.generatedPromptMarkdown,
        promptGenerationMessage: state.promptGenerationMessage,
        isGeneratingPrompt: state.isGeneratingPrompt,
        canGenerate,
        isGenerating: state.isGenerating,
        isHydratingWorkspace: state.isHydratingWorkspace,
        processingProgress: state.processingProgress,
        generatedFlow: state.generatedFlow,
        transcriptSetId: state.transcriptSetId,
        workspaceSaveStatus: state.workspaceSaveStatus,
        workspaceSaveMessage: state.workspaceSaveMessage,
        workspaceSavedAt: state.workspaceSavedAt,
        generatingThoughts: state.generatingThoughts,
        flowRenderState,
        inputSectionCollapsed: state.sidebar.inputCollapsed,
        nodesSectionCollapsed: state.sidebar.nodesCollapsed,
        nodeSearchQuery: state.sidebar.nodeSearchQuery,
        selectedConnectionIndex: state.selectedConnectionIndex,
        detailLevel: state.detailLevel,
      });
    });

    wireThemeToggle(container);
    cleanupEventBindings = wireTranscriptImportEvents({
      container,
      state,
      suppressNextNodeClick,
      render,
      onNavigateHome: () => {
        cleanup();
        router.navigate('/');
      },
      onNavigateBack: () => {
        cleanup();
        router.navigate('/import');
      },
      onGenerateFlow: () => {
        void (async () => {
          if (!state.transcriptSetId) {
            try {
              const limits = await getSubscriptionLimits();
              if (limits.isFreeTier && !limits.canCreateTranscriptSet) {
                await customAlert(`You've reached the limit of ${limits.transcriptSetLimit} transcript sets on the free tier. Upgrade to Pro for unlimited transcript sets.`);
                return;
              }
            } catch {
              // Limits unavailable — allow generation
            }
          }
          void generateFlow(state, {
            render,
            onFlowGenerated: () => {
              scheduleWorkspaceAutosave();
            },
          });
        })();
      },
      onGeneratePromptFromFlow: () => {
        void generatePromptFromCurrentFlow(state, { render });
      },
      onOpenLinkedProject: () => {
        const projectId = resolveLinkedProjectId(state.transcriptSetId);
        if (!projectId) return;
        cleanup();
        router.navigate(`/project/${projectId}`);
      },
      onCreateProjectFromFlow: () => {
        void (async () => {
          try {
            const limits = await getSubscriptionLimits();
            if (limits.isFreeTier && !limits.canCreateTranscriptionFlow) {
              await customAlert(`You've reached the limit of ${limits.transcriptionFlowLimit} transcript flows on the free tier. Upgrade to Pro for unlimited flows.`);
              return;
            }
            if (limits.isFreeTier && !limits.canUseImportTranscript) {
              await customAlert('You have already used Import Transcript on the free tier. Upgrade to Pro for unlimited imports.');
              return;
            }
            createProjectFromGeneratedFlow(state, {
              render,
              cleanupViewportAndNavigate: cleanupViewport,
            });
            await recordFeatureUsage('import_transcript').catch(() => {});
          } catch (err) {
            console.error('Limit check failed:', err);
            createProjectFromGeneratedFlow(state, {
              render,
              cleanupViewportAndNavigate: cleanupViewport,
            });
          }
        })();
      },
      onFlowMutated: () => {
        if (
          state.selectedConnectionIndex !== null
          && state.generatedFlow
          && state.selectedConnectionIndex >= state.generatedFlow.connections.length
        ) {
          state.selectedConnectionIndex = null;
        }
        pinCurrentNodePositions();
        state.flowRevision += 1;
        state.generatedPromptMarkdown = '';
        state.promptGenerationMessage = null;
        render();
        scheduleWorkspaceAutosave();
      },
      onCopyGeneratedPrompt: async () => {
        const prompt = state.generatedPromptMarkdown.trim();
        if (!prompt) return;
        try {
          await navigator.clipboard.writeText(prompt);
          state.promptGenerationMessage = {
            tone: 'success',
            text: 'Generated prompt copied to clipboard.',
          };
        } catch {
          state.promptGenerationMessage = {
            tone: 'error',
            text: 'Failed to copy generated prompt.',
          };
        }
        render();
      },
      onOpenNodeEditor: (node) => {
        openNodeEditorModal(node, {
          onSave: (next) => {
            node.label = next.label;
            node.content = next.content;
            node.type = next.type;
            node.icon = next.icon;
            node.meta = { ...next.meta };
            state.flowRevision += 1;
            state.generatedPromptMarkdown = '';
            state.promptGenerationMessage = null;
            render();
            scheduleWorkspaceAutosave();
          },
        });
      },
      onWorkspaceMetadataChanged: () => {
        scheduleWorkspaceAutosave();
      },
    });

    cleanupFlowViewport = wireFlowViewport({
      container,
      latestRenderedLayout: state.latestRenderedLayout,
      latestRenderedNodeSizes: state.latestRenderedNodeSizes,
      latestRenderedConnections: state.generatedFlow?.connections ?? [],
      nodePositionOverrides: state.nodePositionOverrides,
      savedViewport: state.viewport,
      suppressNextNodeClick,
      onNodeDragCommitted: () => {
        render();
        scheduleWorkspaceAutosave();
      },
    });
  };

  const scheduleWorkspaceAutosave = (): void => {
    if (!state.generatedFlow || !state.transcriptSetId) {
      return;
    }
    if (state.isHydratingWorkspace) {
      return;
    }

    clearAutosaveTimer();
    state.workspaceSaveStatus = 'saving';
    state.workspaceSaveMessage = null;
    render();

    autosaveTimer = setTimeout(() => {
      void saveWorkspaceNow();
    }, WORKSPACE_AUTOSAVE_DEBOUNCE_MS);
  };

  const saveWorkspaceNow = async (): Promise<void> => {
    clearAutosaveTimer();
    if (!state.generatedFlow || !state.transcriptSetId) {
      return;
    }
    if (workspaceSaveInFlight) {
      workspaceSaveQueued = true;
      return;
    }
    workspaceSaveInFlight = true;
    workspaceSaveQueued = false;

    const saveSerial = ++autosaveSerial;
    state.workspaceSaveStatus = 'saving';
    state.workspaceSaveMessage = null;
    render();

    try {
      await upsertTranscriptWorkspaceFlow({
        transcriptSetId: state.transcriptSetId,
        flow: state.generatedFlow,
        projectName: state.projectName.trim() || state.generatedFlow.title,
        nodePositionOverrides: state.nodePositionOverrides,
      });

      if (saveSerial !== autosaveSerial) return;
      state.workspaceSaveStatus = 'saved';
      state.workspaceSavedAt = new Date().toISOString();
      state.workspaceSaveMessage = null;
      render();
    } catch (err) {
      if (saveSerial !== autosaveSerial) return;
      state.workspaceSaveStatus = 'error';
      state.workspaceSaveMessage =
        err instanceof Error ? err.message : 'Failed to save transcript workspace.';
      render();
    } finally {
      workspaceSaveInFlight = false;
      if (saveSerial !== autosaveSerial) {
        workspaceSaveQueued = false;
        return;
      }
      if (workspaceSaveQueued) {
        workspaceSaveQueued = false;
        void saveWorkspaceNow();
      }
    }
  };

  const hydrateWorkspace = async (transcriptSetId: string): Promise<void> => {
    state.isHydratingWorkspace = true;
    state.generationError = '';
    render();

    try {
      const snapshot = await loadTranscriptWorkspace(transcriptSetId);
      state.transcriptSetId = snapshot.transcriptSetId;
      if (snapshot.projectName.trim().length > 0) {
        state.projectName = snapshot.projectName;
      }
      if (snapshot.projectModel.trim().length > 0) {
        state.projectModel = snapshot.projectModel;
      }
      state.generatedFlow = snapshot.flow;
      state.nodePositionOverrides = { ...snapshot.nodePositionOverrides };
      state.latestRenderedLayout = {};
      state.latestRenderedNodeSizes = {};
      state.processingProgress = null;
      state.persistenceMessage = null;
      state.workspaceSaveStatus = 'idle';
      state.workspaceSaveMessage = null;
      state.workspaceSavedAt = null;
      state.flowRevision = snapshot.flow ? 1 : 0;
      state.selectedConnectionIndex = null;
    } catch (err) {
      state.generationError = err instanceof Error ? err.message : 'Failed to load transcript workspace.';
      state.workspaceSaveStatus = 'error';
      state.workspaceSaveMessage = state.generationError;
    } finally {
      state.isHydratingWorkspace = false;
      render();
    }
  };

  render();
  if (routeTranscriptSetId) {
    void hydrateWorkspace(routeTranscriptSetId);
  }
}

function normalizeOptionalId(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveLinkedProjectId(transcriptSetId: string | null): string | null {
  if (!transcriptSetId) return null;
  const draft = store
    .getTranscriptFlowDrafts()
    .find((candidate) => candidate.transcriptSetId === transcriptSetId);
  if (!draft?.projectId) return null;
  if (!store.getProject(draft.projectId)) return null;
  return draft.projectId;
}
