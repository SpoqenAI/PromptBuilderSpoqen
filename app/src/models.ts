export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  model: string;
  icon: string;
  lastEdited: string;
  folderId: string | null;
  nodes: PromptNode[];
  connections: Connection[];
  versions: PromptVersion[];
}

export interface PromptNode {
  id: string;
  type: NodeType;
  label: string;
  icon: string;
  x: number;
  y: number;
  content: string;
  meta: Record<string, string>;
}

export type NodeType =
  | 'core-persona'
  | 'mission-objective'
  | 'tone-guidelines'
  | 'language-model'
  | 'logic-branch'
  | 'termination'
  | 'vector-db'
  | 'static-context'
  | 'memory-buffer'
  | 'webhook'
  | 'transcriber'
  | 'llm-brain'
  | 'voice-synth'
  | 'style-module'
  | 'custom';

export interface Connection {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface PromptGraphSnapshot {
  nodes: PromptNode[];
  connections: Connection[];
}

export interface PromptVersion {
  id: string;
  timestamp: number;
  content: string;
  notes: string;
  snapshot: PromptGraphSnapshot | null;
}

export interface BlockDefinition {
  type: NodeType;
  label: string;
  icon: string;
  category: string;
  defaultContent: string;
}

export interface CustomNodeTemplate {
  id: string;
  type: NodeType;
  label: string;
  icon: string;
  content: string;
  meta: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export const PROMPT_BLOCK_PALETTE: BlockDefinition[] = [
  { type: 'core-persona', label: 'Core Persona', icon: 'psychology', category: 'Identity & Purpose', defaultContent: '# Core Persona\nYou are ...' },
  { type: 'mission-objective', label: 'Mission Objective', icon: 'flag', category: 'Identity & Purpose', defaultContent: '# Mission Objective\nYour primary goal is ...' },
  { type: 'tone-guidelines', label: 'Tone Guidelines', icon: 'record_voice_over', category: 'Voice & Persona', defaultContent: '## Tone Guidelines\n- Maintain a professional voice.\n- Be concise and clear.' },
  { type: 'language-model', label: 'Language Model', icon: 'translate', category: 'Voice & Persona', defaultContent: '## Language\nRespond in English.' },
  { type: 'logic-branch', label: 'Logic Branch', icon: 'alt_route', category: 'Conversation Flow', defaultContent: '## Logic Branch\nIf the user asks about X, then ...' },
  { type: 'termination', label: 'Termination Node', icon: 'call_end', category: 'Conversation Flow', defaultContent: '## Termination\nEnd the conversation gracefully.' },
  { type: 'vector-db', label: 'Vector Database', icon: 'storage', category: 'Knowledge Base', defaultContent: '## Vector DB\nRetrieval context goes here.' },
  { type: 'static-context', label: 'Static Context', icon: 'article', category: 'Knowledge Base', defaultContent: '## Static Context\nBackground information ...' },
  { type: 'memory-buffer', label: 'Memory Buffer', icon: 'history', category: 'Call Management', defaultContent: '## Memory Buffer\n{{conversation_history}}' },
  { type: 'webhook', label: 'Web Hook', icon: 'integration_instructions', category: 'Call Management', defaultContent: '## Webhook\nEndpoint: https://...' },
  { type: 'transcriber', label: 'Transcriber', icon: 'mic', category: 'Model Tiers', defaultContent: '## Transcriber\nModel: Whisper-v3\nSample Rate: 16kHz' },
  { type: 'llm-brain', label: 'LLM Brain', icon: 'psychology', category: 'Model Tiers', defaultContent: '## System Prompt\nrole: "Helpful AI Assistant"\ntone: "Concise & Professional"' },
  { type: 'voice-synth', label: 'Voice Synth', icon: 'record_voice_over', category: 'Model Tiers', defaultContent: '## Voice Model\nVoice: Nova-v2\nStability: 0.5' },
];

export const TRANSCRIPT_BLOCK_PALETTE: BlockDefinition[] = [
  { type: 'core-persona', label: 'Agent Role', icon: 'support_agent', category: 'Transcript Strategy', defaultContent: '## Agent Role\nWho the agent represents and what authority it has in this call.' },
  { type: 'mission-objective', label: 'Call Outcome', icon: 'flag', category: 'Transcript Strategy', defaultContent: '## Call Outcome\nWhat a successful call resolution looks like.' },
  { type: 'tone-guidelines', label: 'Tone Guardrails', icon: 'record_voice_over', category: 'Conversation Behavior', defaultContent: '## Tone Guardrails\nHow the agent should sound across transcript turns.' },
  { type: 'language-model', label: 'Intent Signals', icon: 'insights', category: 'Conversation Behavior', defaultContent: '## Intent Signals\nSignals in user language that should drive routing decisions.' },
  { type: 'logic-branch', label: 'Decision Branch', icon: 'alt_route', category: 'Conversation Behavior', defaultContent: '## Decision Branch\nBranch logic extracted from observed transcript paths.' },
  { type: 'termination', label: 'Resolution / Close', icon: 'call_end', category: 'Conversation Behavior', defaultContent: '## Resolution / Close\nHow to close, hand off, or complete the interaction.' },
  { type: 'memory-buffer', label: 'Conversation Memory', icon: 'history', category: 'Flow Evidence', defaultContent: '## Conversation Memory\nCritical facts from prior turns that must persist.' },
  { type: 'static-context', label: 'Policy Context', icon: 'gavel', category: 'Flow Evidence', defaultContent: '## Policy Context\nConstraints and policies inferred from transcripts.' },
  { type: 'vector-db', label: 'Knowledge Reference', icon: 'menu_book', category: 'Flow Evidence', defaultContent: '## Knowledge Reference\nExternal knowledge required to answer correctly.' },
  { type: 'webhook', label: 'External Action', icon: 'integration_instructions', category: 'Operational Steps', defaultContent: '## External Action\nSystem action triggered by this call state.' },
  { type: 'transcriber', label: 'Transcript Evidence', icon: 'article', category: 'Operational Steps', defaultContent: '## Transcript Evidence\nRepresentative utterances that justify this node.' },
  { type: 'llm-brain', label: 'Reasoning Step', icon: 'psychology', category: 'Operational Steps', defaultContent: '## Reasoning Step\nDecision rubric used at this point in the call.' },
  { type: 'voice-synth', label: 'Response Pattern', icon: 'speaker_notes', category: 'Operational Steps', defaultContent: '## Response Pattern\nPreferred response style for this branch.' },
];

export const BLOCK_PALETTE: BlockDefinition[] = PROMPT_BLOCK_PALETTE;

export type EditorFormat = 'markdown' | 'xml';

export function uid(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}
