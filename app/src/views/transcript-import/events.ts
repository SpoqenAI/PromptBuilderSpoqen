import { uid } from '../../models';
import type { TranscriptFlowNode } from '../../transcript-flow';
import { clearFlowApproval, clearTranscriptSession } from './state';
import type { TranscriptImportState } from './types';
import { normalizeLineEndings } from './format';

interface WireTranscriptImportEventsParams {
  container: HTMLElement;
  state: TranscriptImportState;
  suppressNextNodeClick: { value: boolean };
  render: () => void;
  onNavigateHome: () => void;
  onNavigateBack: () => void;
  onGenerateFlow: () => void;
  onGeneratePromptFromFlow: () => void;
  onCreateProjectFromFlow: () => void;
  onCopyGeneratedPrompt: () => void | Promise<void>;
  onOpenNodeEditor: (node: TranscriptFlowNode) => void;
}

export function wireTranscriptImportEvents(
  params: WireTranscriptImportEventsParams,
): void {
  const {
    container,
    state,
    suppressNextNodeClick,
    render,
    onNavigateHome,
    onNavigateBack,
    onGenerateFlow,
    onGeneratePromptFromFlow,
    onCreateProjectFromFlow,
    onCopyGeneratedPrompt,
    onOpenNodeEditor,
  } = params;

  container.querySelector<HTMLButtonElement>('#nav-home')?.addEventListener('click', () => {
    onNavigateHome();
  });

  container.querySelector<HTMLButtonElement>('#btn-back')?.addEventListener('click', () => {
    onNavigateBack();
  });

  const projectNameInput = container.querySelector<HTMLInputElement>('#transcript-project-name');
  projectNameInput?.addEventListener('input', () => {
    state.projectName = projectNameInput.value;
  });

  const projectModelSelect = container.querySelector<HTMLSelectElement>('#transcript-project-model');
  projectModelSelect?.addEventListener('change', () => {
    state.projectModel = projectModelSelect.value;
  });

  const assistantNameInput = container.querySelector<HTMLInputElement>('#transcript-assistant-name');
  assistantNameInput?.addEventListener('input', () => {
    state.assistantName = assistantNameInput.value;
  });

  const userNameInput = container.querySelector<HTMLInputElement>('#transcript-user-name');
  userNameInput?.addEventListener('input', () => {
    state.userName = userNameInput.value;
  });

  const dropZone = container.querySelector<HTMLElement>('#transcript-drop-zone');
  const fileInput = container.querySelector<HTMLInputElement>('#transcript-file');

  container.querySelector<HTMLElement>('#btn-upload-transcript')?.addEventListener('click', (event) => {
    event.stopPropagation();
    fileInput?.click();
  });

  dropZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('border-primary', 'bg-primary/5');
  });

  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-primary', 'bg-primary/5');
  });

  dropZone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('border-primary', 'bg-primary/5');
    if (event.dataTransfer?.files) {
      handleFiles(Array.from(event.dataTransfer.files));
    }
  });

  fileInput?.addEventListener('change', () => {
    if (fileInput.files) {
      handleFiles(Array.from(fileInput.files));
      fileInput.value = '';
    }
  });

  function handleFiles(files: File[]) {
    let processed = 0;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        state.transcripts.push({
          id: uid(),
          name: file.name,
          content: normalizeLineEndings(content),
        });
        processed += 1;
        if (processed === files.length) {
          state.generationError = '';
          state.persistenceMessage = null;
          state.generatedPromptMarkdown = '';
          state.promptGenerationMessage = null;
          clearFlowApproval(state);
          render();
        }
      };
      reader.readAsText(file);
    }
  }

  container.querySelectorAll<HTMLButtonElement>('[data-remove-transcript]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = button.dataset.removeTranscript;
      state.transcripts = state.transcripts.filter((transcript) => transcript.id !== id);
      state.generatedPromptMarkdown = '';
      state.promptGenerationMessage = null;
      render();
    });
  });

  container.querySelector<HTMLButtonElement>('#btn-clear-transcript')?.addEventListener('click', () => {
    clearTranscriptSession(state);
    render();
  });

  container.querySelector<HTMLButtonElement>('#btn-generate-flow')?.addEventListener('click', () => {
    onGenerateFlow();
  });

  container.querySelector<HTMLButtonElement>('#btn-create-flow-project')?.addEventListener('click', () => {
    onCreateProjectFromFlow();
  });

  container.querySelector<HTMLButtonElement>('#btn-generate-prompt-from-flow')?.addEventListener('click', () => {
    onGeneratePromptFromFlow();
  });

  container.querySelector<HTMLButtonElement>('#btn-copy-generated-prompt')?.addEventListener('click', () => {
    void onCopyGeneratedPrompt();
  });

  container.querySelector<HTMLButtonElement>('#btn-approve-flow')?.addEventListener('click', () => {
    if (!state.generatedFlow) return;
    state.approvedRevision = state.flowRevision;
    state.approvedAt = new Date().toISOString();
    state.generationError = '';
    render();
  });

  container.querySelector<HTMLButtonElement>('#btn-regenerate-flow')?.addEventListener('click', () => {
    onGenerateFlow();
  });

  container.querySelectorAll<HTMLElement>('[data-flow-node-id]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (suppressNextNodeClick.value) return;
      event.stopPropagation();
      const nodeId = element.dataset.flowNodeId ?? null;
      if (!nodeId || !state.generatedFlow) return;
      const node = state.generatedFlow.nodes.find((candidate) => candidate.id === nodeId);
      if (node) onOpenNodeEditor(node);
    });
  });

  container.querySelector<HTMLElement>('#flow-viewport')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.id === 'flow-viewport' || target.closest('svg')) {
      return;
    }
  });
}
