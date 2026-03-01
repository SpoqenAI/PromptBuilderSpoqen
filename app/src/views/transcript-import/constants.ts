export const DEFAULT_PROJECT_NAME = 'Transcript Flow';
export const DEFAULT_PROJECT_MODEL = 'GPT-4o';
export const MIN_TRANSCRIPT_LENGTH = 20;
export const TRANSCRIPT_NODE_MIN_WIDTH = 224;
export const TRANSCRIPT_NODE_HEIGHT = 140;
export const TRANSCRIPT_NODE_DECORATION_WIDTH = 128;
export const TRANSCRIPT_NODE_X_GAP = 300;
export const TRANSCRIPT_NODE_Y_GAP = 350;

export const GENERATING_THOUGHT_POOL = [
  'Untangling speaker turns and hidden intents...',
  'Negotiating peace between interruptions and edge cases...',
  'Folding small talk into deterministic state machines...',
  'Asking the transcript politely what happened here...',
  'Ranking branches by "would a human do this?" confidence...',
  'Converting "uhh" into production-grade transitions...',
  'Cross-checking every handoff for dropped context...',
  'Simulating awkward silence as a first-class node...',
  'Optimizing loops so callers do not loop forever...',
  'Pinning down escalation paths before they escape...',
  'Teaching the graph to survive Friday-night support traffic...',
  'Adding labels so future-you does not squint at edges...',
] as const;

export const GENERATING_THOUGHTS_VISIBLE = 6;
export const GENERATING_THOUGHT_STEP_SECONDS = 2;
