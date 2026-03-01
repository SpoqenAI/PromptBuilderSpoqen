import { router } from '../../router';
import { wireThemeToggle } from '../../theme';
import { preserveScrollDuringRender } from '../../view-state';
import { createProjectFromGeneratedFlow, generateFlow, generatePromptFromCurrentFlow } from './actions';
import { wireTranscriptImportEvents } from './events';
import { buildFlowRenderState, cloneLayout } from './layout';
import { openNodeEditorModal } from './node-editor-modal';
import {
  clearFlowApproval,
  createTranscriptImportState,
  isCurrentFlowApproved,
} from './state';
import { renderTranscriptImportShell } from './template';
import { wireFlowViewport } from './viewport';

export function renderTranscriptImport(container: HTMLElement): void {
  const state = createTranscriptImportState();
  const suppressNextNodeClick = { value: false };
  let cleanupFlowViewport: (() => void) | null = null;

  const cleanupViewport = () => {
    cleanupFlowViewport?.();
    cleanupFlowViewport = null;
  };

  const render = (): void => {
    cleanupViewport();

    const canGenerate = state.transcripts.length > 0 && !state.isGenerating;
    const flowApproved = isCurrentFlowApproved(state);
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
        assistantName: state.assistantName,
        userName: state.userName,
        transcripts: state.transcripts,
        generationError: state.generationError,
        persistenceMessage: state.persistenceMessage,
        generatedPromptMarkdown: state.generatedPromptMarkdown,
        promptGenerationMessage: state.promptGenerationMessage,
        isGeneratingPrompt: state.isGeneratingPrompt,
        canGenerate,
        isGenerating: state.isGenerating,
        processingProgress: state.processingProgress,
        generatedFlow: state.generatedFlow,
        flowApproved,
        approvedAt: state.approvedAt,
        generatingThoughts: state.generatingThoughts,
        flowRenderState,
      });
    });

    wireThemeToggle(container);
    wireTranscriptImportEvents({
      container,
      state,
      suppressNextNodeClick,
      render,
      onNavigateHome: () => {
        cleanupViewport();
        router.navigate('/');
      },
      onNavigateBack: () => {
        cleanupViewport();
        router.navigate('/import');
      },
      onGenerateFlow: () => {
        void generateFlow(state, { render });
      },
      onGeneratePromptFromFlow: () => {
        void generatePromptFromCurrentFlow(state, { render });
      },
      onCreateProjectFromFlow: () => {
        createProjectFromGeneratedFlow(state, {
          render,
          cleanupViewportAndNavigate: cleanupViewport,
        });
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
            state.flowRevision += 1;
            state.generatedPromptMarkdown = '';
            state.promptGenerationMessage = null;
            clearFlowApproval(state);
            render();
          },
        });
      },
    });

    cleanupFlowViewport = wireFlowViewport({
      container,
      latestRenderedLayout: state.latestRenderedLayout,
      latestRenderedNodeSizes: state.latestRenderedNodeSizes,
      nodePositionOverrides: state.nodePositionOverrides,
      savedViewport: state.viewport,
      suppressNextNodeClick,
      onNodeDragCommitted: render,
    });
  };

  render();
}
