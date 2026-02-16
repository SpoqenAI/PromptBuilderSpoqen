/* ── Domain Models ─────────────────────────────── */

export interface Project {
  id: string;
  name: string;
  description: string;
  model: string;
  icon: string;
  lastEdited: string;
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
  from: string;   // node ID
  to: string;     // node ID
}

export interface PromptVersion {
  id: string;
  timestamp: number;
  content: string;
  notes: string;
}

/* ── Sidebar block palette definition ─────────── */

export interface BlockDefinition {
  type: NodeType;
  label: string;
  icon: string;
  category: string;
  defaultContent: string;
}

export const BLOCK_PALETTE: BlockDefinition[] = [
  // Identity & Purpose
  { type: 'core-persona', label: 'Core Persona', icon: 'psychology', category: 'Identity & Purpose', defaultContent: '# Core Persona\nYou are ...' },
  { type: 'mission-objective', label: 'Mission Objective', icon: 'flag', category: 'Identity & Purpose', defaultContent: '# Mission Objective\nYour primary goal is ...' },
  // Voice & Persona
  { type: 'tone-guidelines', label: 'Tone Guidelines', icon: 'record_voice_over', category: 'Voice & Persona', defaultContent: '## Tone Guidelines\n- Maintain a professional voice.\n- Be concise and clear.' },
  { type: 'language-model', label: 'Language Model', icon: 'translate', category: 'Voice & Persona', defaultContent: '## Language\nRespond in English.' },
  // Conversation Flow
  { type: 'logic-branch', label: 'Logic Branch', icon: 'alt_route', category: 'Conversation Flow', defaultContent: '## Logic Branch\nIf the user asks about X, then ...' },
  { type: 'termination', label: 'Termination Node', icon: 'call_end', category: 'Conversation Flow', defaultContent: '## Termination\nEnd the conversation gracefully.' },
  // Knowledge Base
  { type: 'vector-db', label: 'Vector Database', icon: 'storage', category: 'Knowledge Base', defaultContent: '## Vector DB\nRetrieval context goes here.' },
  { type: 'static-context', label: 'Static Context', icon: 'article', category: 'Knowledge Base', defaultContent: '## Static Context\nBackground information ...' },
  // Call Management
  { type: 'memory-buffer', label: 'Memory Buffer', icon: 'history', category: 'Call Management', defaultContent: '## Memory Buffer\n{{conversation_history}}' },
  { type: 'webhook', label: 'Web Hook', icon: 'integration_instructions', category: 'Call Management', defaultContent: '## Webhook\nEndpoint: https://...' },
  // Model Tiers (voice orchestration)
  { type: 'transcriber', label: 'Transcriber', icon: 'mic', category: 'Model Tiers', defaultContent: '## Transcriber\nModel: Whisper-v3\nSample Rate: 16kHz' },
  { type: 'llm-brain', label: 'LLM Brain', icon: 'psychology', category: 'Model Tiers', defaultContent: '## System Prompt\nrole: "Helpful AI Assistant"\ntone: "Concise & Professional"' },
  { type: 'voice-synth', label: 'Voice Synth', icon: 'record_voice_over', category: 'Model Tiers', defaultContent: '## Voice Model\nVoice: Nova-v2\nStability: 0.5' },
];

/* ── Editor language format ───────────────────── */
export type EditorFormat = 'markdown' | 'xml';

/* ── Helper to create unique IDs ──────────────── */
export function uid(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}
