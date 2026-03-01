/**
 * Store - Manages application state backed by Supabase.
 *
 * Strategy: load-on-init into memory; sync reads, async writes.
 * All mutating calls update the in-memory cache immediately (keeping
 * the UI synchronous) and fire a background Supabase call.
 */
import { Project, PromptNode, Connection, PromptGraphSnapshot, PromptVersion, NodeType, uid, CustomNodeTemplate } from './models';
import type { Database } from './database.types';
import { supabase } from './supabase';
import { resolveNodeIcon } from './node-icons';
import type { TranscriptFlowResult } from './transcript-flow';

type ProjectRow = Database['public']['Tables']['projects']['Row'];
type PromptNodeRow = Database['public']['Tables']['prompt_nodes']['Row'];
type PromptNodeUpdate = Database['public']['Tables']['prompt_nodes']['Update'];
type ConnectionRow = Database['public']['Tables']['connections']['Row'];
type PromptVersionRow = Database['public']['Tables']['prompt_versions']['Row'];
type CustomNodeRow = Database['public']['Tables']['custom_nodes']['Row'];
type TranscriptSetRow = Database['public']['Tables']['transcript_sets']['Row'];
type TranscriptRow = Database['public']['Tables']['transcripts']['Row'];
type TranscriptFlowRow = Database['public']['Tables']['transcript_flows']['Row'];

export type PersistenceMode = 'database' | 'local-fallback';

export interface StorePersistenceStatus {
  mode: PersistenceMode;
  error: string | null;
  hint: string | null;
}

export interface StoreRemoteErrorEventDetail extends StorePersistenceStatus {
  context: string;
}

export type PromptAssemblyMode = 'runtime' | 'flow-template';

interface LocalStorePayload {
  projects: Project[];
  customNodeTemplates: CustomNodeTemplate[];
  transcriptFlowDrafts?: TranscriptFlowDraft[];
}

export interface TranscriptFlowDraftDetail {
  transcriptFlowId: string;
  transcriptId: string;
  createdAt: string;
  model: string;
  flowTitle: string;
  flowSummary: string;
  usedFallback: boolean;
  warning: string;
  nodeCount: number;
  connectionCount: number;
  nodesJson: unknown[];
  connectionsJson: unknown[];
}

export interface TranscriptFlowDraft {
  transcriptSetId: string;
  projectId: string | null;
  name: string;
  description: string;
  source: string;
  updatedAt: string;
  latestFlow: TranscriptFlowDraftDetail | null;
}

interface ParsedTranscriptNodeSeed {
  sourceId: string;
  type: NodeType;
  label: string;
  icon: string;
  content: string;
  meta: Record<string, string>;
}

interface ParsedTranscriptConnectionSeed {
  from: string;
  to: string;
  label: string;
}

/* Store state */
class Store {
  private projects: Project[] = [];
  private customNodeTemplates: CustomNodeTemplate[] = [];
  private transcriptFlowDrafts: TranscriptFlowDraft[] = [];
  private transcriptSetIdByProjectId = new Map<string, string>();
  private _ready: Promise<void> | null = null;
  private remoteWriteChain: Promise<void> = Promise.resolve();
  private currentUserId: string | null = null;
  private persistenceStatus: StorePersistenceStatus = {
    mode: 'database',
    error: null,
    hint: null,
  };

  /** Resolves when all Supabase data is loaded into memory. */
  get ready(): Promise<void> {
    if (!this._ready) {
      this._ready = this.init();
    }
    return this._ready;
  }

  getPersistenceStatus(): StorePersistenceStatus {
    return { ...this.persistenceStatus };
  }

  reset(): void {
    this.projects = [];
    this.customNodeTemplates = [];
    this.transcriptFlowDrafts = [];
    this.transcriptSetIdByProjectId.clear();
    this._ready = null;
    this.remoteWriteChain = Promise.resolve();
    this.currentUserId = null;
    this.persistenceStatus = {
      mode: 'database',
      error: null,
      hint: null,
    };
  }

  /* Initialization */

  private async init(): Promise<void> {
    try {
      const userId = await this.ensureSession();

      // 1. Fetch top-level account data in parallel
      const [projectsRes, customNodesRes, transcriptSetsRes] = await Promise.all([
        supabase
          .from('projects')
          .select('*')
          .eq('owner_id', userId)
          .order('created_at', { ascending: false }),
        supabase
          .from('custom_nodes')
          .select('*')
          .eq('owner_id', userId)
          .order('created_at', { ascending: false }),
        supabase
          .from('transcript_sets')
          .select('*')
          .eq('owner_id', userId)
          .order('updated_at', { ascending: false }),
      ]);
      this.assertNoError(projectsRes, 'fetch projects');

      const projectRows = toTypedRows(projectsRes.data, isProjectRow, 'projects');
      if (customNodesRes.error) {
        if (isCustomNodesTableMissing(customNodesRes.error.message)) {
          this.customNodeTemplates = [];
        } else {
          this.assertNoError(customNodesRes, 'fetch custom_nodes');
        }
      } else {
        const customNodeRows = toTypedRows(customNodesRes.data, isCustomNodeRow, 'custom_nodes');
        this.customNodeTemplates = customNodeRows.map(toCustomNodeTemplate);
      }

      let transcriptSetRows: TranscriptSetRow[] = [];
      if (transcriptSetsRes.error) {
        if (isTranscriptTableMissing(transcriptSetsRes.error.message, 'transcript_sets')) {
          transcriptSetRows = [];
        } else {
          this.assertNoError(transcriptSetsRes, 'fetch transcript_sets');
        }
      } else {
        transcriptSetRows = toTypedRows(transcriptSetsRes.data, isTranscriptSetRow, 'transcript_sets');
      }

      // 2. Fetch project child rows in parallel
      const projectIds = projectRows.map((row) => row.id);
      let nodeRows: PromptNodeRow[] = [];
      let connectionRows: ConnectionRow[] = [];
      let versionRows: PromptVersionRow[] = [];
      if (projectIds.length > 0) {
        const [nodesRes, connsRes, versRes] = await Promise.all([
          supabase.from('prompt_nodes').select('*').in('project_id', projectIds).order('sort_order'),
          supabase.from('connections').select('*').in('project_id', projectIds),
          supabase.from('prompt_versions').select('*').in('project_id', projectIds).order('timestamp'),
        ]);
        this.assertNoError(nodesRes, 'fetch prompt_nodes');
        this.assertNoError(connsRes, 'fetch connections');
        this.assertNoError(versRes, 'fetch prompt_versions');

        nodeRows = toTypedRows(nodesRes.data, isPromptNodeRow, 'prompt_nodes');
        connectionRows = toTypedRows(connsRes.data, isConnectionRow, 'connections');
        versionRows = toTypedRows(versRes.data, isPromptVersionRow, 'prompt_versions');
      }

      const nodesByProject = groupByProjectId(nodeRows);
      const connsByProject = groupByProjectId(connectionRows);
      const versByProject = groupByProjectId(versionRows);

      this.projects = projectRows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        model: row.model,
        icon: row.icon,
        lastEdited: row.last_edited,
        nodes: (nodesByProject[row.id] ?? []).map(toPromptNode),
        connections: (connsByProject[row.id] ?? []).map(toConnection),
        versions: (versByProject[row.id] ?? []).map(toVersion),
      }));

      this.transcriptFlowDrafts = [];
      this.transcriptSetIdByProjectId.clear();
      if (transcriptSetRows.length > 0) {
        this.transcriptFlowDrafts = await this.loadTranscriptFlowDrafts(transcriptSetRows);
        this.rebuildTranscriptProjectLinkIndex();
      }
    } catch (err) {
      this.setPersistenceFallback('initialization', err);
      if (this.isSchemaMismatch(err)) {
        console.error(
          'Supabase schema mismatch detected. Apply: supabase/migrations/20260216143000_reconcile_promptbuilder_schema.sql'
        );
      }
      this.loadLocalStorage();
    }
  }

  private async loadTranscriptFlowDrafts(transcriptSetRows: TranscriptSetRow[]): Promise<TranscriptFlowDraft[]> {
    const transcriptSetIds = transcriptSetRows.map((row) => row.id);
    if (transcriptSetIds.length === 0) return [];

    const transcriptsRes = await supabase
      .from('transcripts')
      .select('*')
      .in('transcript_set_id', transcriptSetIds)
      .order('created_at', { ascending: false });

    let transcriptRows: TranscriptRow[] = [];
    if (transcriptsRes.error) {
      if (!isTranscriptTableMissing(transcriptsRes.error.message, 'transcripts')) {
        this.assertNoError(transcriptsRes, 'fetch transcripts');
      }
    } else {
      transcriptRows = toTypedRows(transcriptsRes.data, isTranscriptRow, 'transcripts');
    }

    const transcriptSetIdByTranscriptId = new Map<string, string>();
    for (const transcriptRow of transcriptRows) {
      transcriptSetIdByTranscriptId.set(transcriptRow.id, transcriptRow.transcript_set_id);
    }

    let flowRows: TranscriptFlowRow[] = [];
    const transcriptIds = transcriptRows.map((row) => row.id);
    if (transcriptIds.length > 0) {
      const transcriptFlowsRes = await supabase
        .from('transcript_flows')
        .select('*')
        .in('transcript_id', transcriptIds)
        .order('created_at', { ascending: false });

      if (transcriptFlowsRes.error) {
        if (!isTranscriptTableMissing(transcriptFlowsRes.error.message, 'transcript_flows')) {
          this.assertNoError(transcriptFlowsRes, 'fetch transcript_flows');
        }
      } else {
        flowRows = toTypedRows(transcriptFlowsRes.data, isTranscriptFlowRow, 'transcript_flows');
      }
    }

    const latestFlowBySetId = new Map<string, TranscriptFlowDraftDetail>();
    for (const flowRow of flowRows) {
      const transcriptSetId = transcriptSetIdByTranscriptId.get(flowRow.transcript_id);
      if (!transcriptSetId) continue;
      const currentLatest = latestFlowBySetId.get(transcriptSetId);
      if (currentLatest && currentLatest.createdAt >= flowRow.created_at) {
        continue;
      }
      latestFlowBySetId.set(transcriptSetId, toTranscriptFlowDraftDetail(flowRow));
    }

    return transcriptSetRows.map((row) => ({
      transcriptSetId: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      source: row.source,
      updatedAt: row.updated_at,
      latestFlow: latestFlowBySetId.get(row.id) ?? null,
    }));
  }

  private rebuildTranscriptProjectLinkIndex(): void {
    this.transcriptSetIdByProjectId.clear();
    for (const draft of this.transcriptFlowDrafts) {
      if (!draft.projectId) continue;
      this.transcriptSetIdByProjectId.set(draft.projectId, draft.transcriptSetId);
    }
  }

  /* localStorage fallback */

  private loadLocalStorage(): void {
    const raw = localStorage.getItem(this.storageKey());
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isProjectArray(parsed)) {
          this.projects = parsed;
          this.customNodeTemplates = [];
          this.transcriptFlowDrafts = [];
          this.transcriptSetIdByProjectId.clear();
          return;
        }
        if (isLocalStorePayload(parsed)) {
          this.projects = parsed.projects;
          this.customNodeTemplates = parsed.customNodeTemplates;
          this.transcriptFlowDrafts = parsed.transcriptFlowDrafts ?? [];
          this.rebuildTranscriptProjectLinkIndex();
          return;
        }
        this.projects = [];
        this.customNodeTemplates = [];
        this.transcriptFlowDrafts = [];
        this.transcriptSetIdByProjectId.clear();
      } catch {
        this.projects = [];
        this.customNodeTemplates = [];
        this.transcriptFlowDrafts = [];
        this.transcriptSetIdByProjectId.clear();
      }
    } else {
      this.projects = [];
      this.customNodeTemplates = [];
      this.transcriptFlowDrafts = [];
      this.transcriptSetIdByProjectId.clear();
    }
  }

  private saveLocalStorage(): void {
    const payload: LocalStorePayload = {
      projects: this.projects,
      customNodeTemplates: this.customNodeTemplates,
      transcriptFlowDrafts: this.transcriptFlowDrafts,
    };
    localStorage.setItem(this.storageKey(), JSON.stringify(payload));
  }

  /* Remote helpers */

  private async ensureSession(): Promise<string> {
    const sessionRes = await supabase.auth.getSession();
    this.assertNoError(sessionRes, 'read auth session');

    const userId = sessionRes.data.session?.user.id;
    if (!userId) {
      throw new Error('No authenticated session. Sign in to use cloud sync.');
    }
    this.currentUserId = userId;
    return userId;
  }

  private assertNoError(result: { error: { message: string } | null }, context: string): void {
    if (result.error) {
      throw new Error(`${context}: ${result.error.message}`);
    }
  }

  private storageKey(): string {
    return this.currentUserId
      ? `promptblueprint_projects_${this.currentUserId}`
      : 'promptblueprint_projects_guest';
  }

  private setPersistenceFallback(context: string, err: unknown): void {
    const error = getErrorMessage(err);
    const hint = getPersistenceHint(error);
    this.persistenceStatus = {
      mode: 'local-fallback',
      error,
      hint,
    };

    console.error(`Supabase ${context} failed, using localStorage fallback: ${error}`);
    if (hint) {
      console.error(hint);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<StoreRemoteErrorEventDetail>('store:remote-error', {
        detail: {
          context,
          ...this.persistenceStatus,
        },
      }));
    }
  }

  private isSchemaMismatch(err: unknown): boolean {
    const message = getErrorMessage(err);
    return message.includes('schema cache') || message.includes("Could not find the '");
  }

  private async insertProjectRemote(p: Project, ownerId: string): Promise<void> {
    const res = await supabase.from('projects').insert({
      id: p.id,
      owner_id: ownerId,
      name: p.name,
      description: p.description,
      model: p.model,
      icon: p.icon,
      last_edited: p.lastEdited,
    });
    this.assertNoError(res, 'insert project');
  }

  private bg(fn: () => Promise<void>): void {
    if (this.persistenceStatus.mode !== 'database') {
      this.saveLocalStorage();
      return;
    }

    this.remoteWriteChain = this.remoteWriteChain
      .then(async () => {
        if (this.persistenceStatus.mode !== 'database') return;
        await fn();
      })
      .catch((err: unknown) => {
        this.setPersistenceFallback('background write', err);
      });

    this.saveLocalStorage(); // always keep localStorage in sync as fallback
  }

  /* Read operations (sync, from cache) */

  getProjects(): Project[] {
    return this.projects;
  }

  getProject(id: string): Project | undefined {
    return this.projects.find(p => p.id === id);
  }

  getPromptFlowProjects(): Project[] {
    return this.projects.filter((project) => !this.transcriptSetIdByProjectId.has(project.id));
  }

  getTranscriptFlowDrafts(): TranscriptFlowDraft[] {
    return this.transcriptFlowDrafts
      .map((draft) => cloneTranscriptFlowDraft(draft))
      .sort((left, right) => compareTranscriptDraftRecency(left, right));
  }

  registerTranscriptFlowDraft(
    transcriptSetId: string,
    flow: TranscriptFlowResult,
    transcriptFlowId: string,
    projectName: string,
  ): void {
    const nowIso = new Date().toISOString();
    const latestFlow = transcriptFlowResultToDraftDetail(flow, transcriptFlowId, nowIso);
    const existing = this.transcriptFlowDrafts.find((item) => item.transcriptSetId === transcriptSetId);
    if (existing) {
      existing.latestFlow = latestFlow;
      existing.updatedAt = nowIso;
      if (!existing.name.trim()) {
        existing.name = `${projectName.trim() || flow.title || 'Transcript'} Transcript Set`;
      }
      if (!existing.description.trim()) {
        existing.description = flow.summary;
      }
    } else {
      this.transcriptFlowDrafts.unshift({
        transcriptSetId,
        projectId: null,
        name: `${projectName.trim() || flow.title || 'Transcript'} Transcript Set`,
        description: flow.summary,
        source: 'transcript-import',
        updatedAt: nowIso,
        latestFlow,
      });
    }
    this.rebuildTranscriptProjectLinkIndex();
    this.saveLocalStorage();
  }

  linkTranscriptSetToProject(
    transcriptSetId: string,
    projectId: string,
    fallbackFlow: TranscriptFlowResult | null = null,
  ): void {
    const nowIso = new Date().toISOString();
    let draft = this.transcriptFlowDrafts.find((item) => item.transcriptSetId === transcriptSetId);
    if (!draft) {
      draft = {
        transcriptSetId,
        projectId,
        name: 'Transcript Set',
        description: '',
        source: 'transcript-import',
        updatedAt: nowIso,
        latestFlow: fallbackFlow ? transcriptFlowResultToDraftDetail(fallbackFlow, uid(), nowIso) : null,
      };
      this.transcriptFlowDrafts.unshift(draft);
    } else {
      draft.projectId = projectId;
      draft.updatedAt = nowIso;
      if (fallbackFlow && !draft.latestFlow) {
        draft.latestFlow = transcriptFlowResultToDraftDetail(fallbackFlow, uid(), nowIso);
      }
    }
    this.rebuildTranscriptProjectLinkIndex();

    this.bg(async () => {
      const updateRes = await supabase
        .from('transcript_sets')
        .update({ project_id: projectId, updated_at: nowIso })
        .eq('id', transcriptSetId);
      if (updateRes.error && isTranscriptTableMissing(updateRes.error.message, 'transcript_sets')) {
        return;
      }
      this.assertNoError(updateRes, 'link transcript_set project');
    });
  }

  createProjectFromTranscriptFlowDraft(transcriptSetId: string): Project | null {
    const draft = this.transcriptFlowDrafts.find((item) => item.transcriptSetId === transcriptSetId);
    if (!draft || !draft.latestFlow) return null;

    if (draft.projectId) {
      const existingProject = this.getProject(draft.projectId);
      if (existingProject) return existingProject;
      draft.projectId = null;
      this.rebuildTranscriptProjectLinkIndex();
    }

    const project = this.createProject(
      draft.latestFlow.flowTitle.trim() || draft.name.trim() || 'Transcript Flow',
      draft.latestFlow.flowSummary.trim() || draft.description,
      draft.latestFlow.model.trim() || 'GPT-4o',
    );

    const parsedNodes = parseStoredTranscriptNodes(draft.latestFlow.nodesJson);
    if (parsedNodes.length === 0) {
      return null;
    }
    const parsedConnections = parseStoredTranscriptConnections(draft.latestFlow.connectionsJson, new Set(parsedNodes.map((node) => node.sourceId)));
    const layout = computeTranscriptSeedLayout(parsedNodes, parsedConnections);
    const nodeIdMap = new Map<string, string>();

    for (const parsedNode of parsedNodes) {
      const position = layout[parsedNode.sourceId] ?? { x: 80, y: 80 };
      const promptNode: PromptNode = {
        id: uid(),
        type: parsedNode.type,
        label: parsedNode.label,
        icon: parsedNode.icon,
        x: position.x,
        y: position.y,
        content: parsedNode.content,
        meta: { ...parsedNode.meta },
      };
      this.addNode(project.id, promptNode);
      nodeIdMap.set(parsedNode.sourceId, promptNode.id);
    }

    for (const connection of parsedConnections) {
      const from = nodeIdMap.get(connection.from);
      const to = nodeIdMap.get(connection.to);
      if (!from || !to) continue;
      this.addConnection(project.id, from, to, connection.label);
    }

    this.saveAssembledVersion(project.id, 'Initial transcript flow import');
    this.linkTranscriptSetToProject(transcriptSetId, project.id);
    return project;
  }

  private syncTranscriptDraftCacheFromProject(project: Project): void {
    const transcriptSetId = this.transcriptSetIdByProjectId.get(project.id);
    if (!transcriptSetId) return;
    const draft = this.transcriptFlowDrafts.find((item) => item.transcriptSetId === transcriptSetId);
    if (!draft) return;

    const nowIso = new Date().toISOString();
    draft.projectId = project.id;
    draft.updatedAt = nowIso;
    draft.latestFlow = projectToTranscriptDraftDetail(
      project,
      nowIso,
      draft.latestFlow?.transcriptFlowId,
      draft.latestFlow?.transcriptId,
    );
  }

  getCustomNodeTemplates(): CustomNodeTemplate[] {
    return this.customNodeTemplates;
  }

  saveCustomNodeTemplate(template: Omit<CustomNodeTemplate, 'id' | 'createdAt' | 'updatedAt'>): CustomNodeTemplate {
    const now = new Date().toISOString();
    const normalizedType = isNodeType(template.type) ? template.type : 'custom';
    const savedTemplate: CustomNodeTemplate = {
      id: uid(),
      type: normalizedType,
      label: normalizeCustomNodeTemplateLabel(template.label),
      icon: template.icon.trim() || 'widgets',
      content: template.content,
      meta: { ...template.meta },
      createdAt: now,
      updatedAt: now,
    };
    this.customNodeTemplates.unshift(savedTemplate);
    this.bg(async () => {
      await this.insertCustomNodeRemote(savedTemplate);
    });
    return savedTemplate;
  }

  removeCustomNodeTemplate(templateId: string): void {
    this.customNodeTemplates = this.customNodeTemplates.filter((template) => template.id !== templateId);
    this.bg(async () => {
      const customDeleteRes = await supabase.from('custom_nodes').delete().eq('id', templateId);
      if (customDeleteRes.error && isCustomNodesTableMissing(customDeleteRes.error.message)) {
        return;
      }
      this.assertNoError(customDeleteRes, 'delete custom_node');
    });
  }

  /* Project mutations */

  createProject(name: string, description: string, model: string): Project {
    const project: Project = {
      id: uid(), name, description, model,
      icon: 'schema', lastEdited: 'Just now',
      nodes: [], connections: [], versions: [],
    };
    this.projects.unshift(project);
    this.bg(async () => {
      if (!this.currentUserId) {
        throw new Error('No active user in store session.');
      }
      await this.insertProjectRemote(project, this.currentUserId);
    });
    return project;
  }

  async createTranscriptFlowProject(name: string, description: string, model: string): Promise<Project> {
    const normalizedName = name.trim() || 'Untitled Transcript Flow';
    const normalizedDescription = description.trim() || 'Manual transcript flow workspace.';
    const project = this.createProject(normalizedName, normalizedDescription, model);
    const nowIso = new Date().toISOString();

    if (this.persistenceStatus.mode !== 'database') {
      const localTranscriptSetId = `local-${uid()}`;
      this.transcriptFlowDrafts.unshift({
        transcriptSetId: localTranscriptSetId,
        projectId: project.id,
        name: `${normalizedName} Transcript Set`,
        description: normalizedDescription,
        source: 'manual-transcript-flow',
        updatedAt: nowIso,
        latestFlow: projectToTranscriptDraftDetail(project, nowIso),
      });
      this.rebuildTranscriptProjectLinkIndex();
      this.saveLocalStorage();
      return project;
    }

    try {
      const ownerId = this.currentUserId ?? await this.ensureSession();
      const transcriptSetRes = await supabase
        .from('transcript_sets')
        .insert({
          owner_id: ownerId,
          project_id: null,
          name: `${normalizedName} Transcript Set`,
          description: normalizedDescription,
          source: 'manual-transcript-flow',
        })
        .select('*')
        .single();

      if (transcriptSetRes.error || !transcriptSetRes.data) {
        throw new Error(transcriptSetRes.error?.message ?? 'Failed to create transcript set.');
      }

      const transcriptSet = transcriptSetRes.data;
      this.transcriptFlowDrafts.unshift({
        transcriptSetId: transcriptSet.id,
        projectId: project.id,
        name: transcriptSet.name,
        description: transcriptSet.description,
        source: transcriptSet.source,
        updatedAt: transcriptSet.updated_at,
        latestFlow: projectToTranscriptDraftDetail(project, nowIso),
      });
      this.rebuildTranscriptProjectLinkIndex();
      this.saveLocalStorage();
      this.linkTranscriptSetToProject(transcriptSet.id, project.id);
      return project;
    } catch (err) {
      this.setPersistenceFallback('create transcript flow project', err);
      const localTranscriptSetId = `local-${uid()}`;
      this.transcriptFlowDrafts.unshift({
        transcriptSetId: localTranscriptSetId,
        projectId: project.id,
        name: `${normalizedName} Transcript Set`,
        description: normalizedDescription,
        source: 'manual-transcript-flow',
        updatedAt: nowIso,
        latestFlow: projectToTranscriptDraftDetail(project, nowIso),
      });
      this.rebuildTranscriptProjectLinkIndex();
      this.saveLocalStorage();
      return project;
    }
  }

  deleteTranscriptFlow(transcriptSetId: string): void {
    const draft = this.transcriptFlowDrafts.find((item) => item.transcriptSetId === transcriptSetId);
    if (!draft) return;

    const linkedProjectId = draft.projectId;
    this.transcriptFlowDrafts = this.transcriptFlowDrafts.filter((item) => item.transcriptSetId !== transcriptSetId);
    if (linkedProjectId) {
      this.transcriptSetIdByProjectId.delete(linkedProjectId);
      this.projects = this.projects.filter((project) => project.id !== linkedProjectId);
    }

    this.bg(async () => {
      const transcriptSetDeleteRes = await supabase
        .from('transcript_sets')
        .delete()
        .eq('id', transcriptSetId);
      if (transcriptSetDeleteRes.error && !isTranscriptTableMissing(transcriptSetDeleteRes.error.message, 'transcript_sets')) {
        this.assertNoError(transcriptSetDeleteRes, 'delete transcript_set');
      }

      if (!linkedProjectId) return;
      const projectDeleteRes = await supabase
        .from('projects')
        .delete()
        .eq('id', linkedProjectId);
      this.assertNoError(projectDeleteRes, 'delete linked transcript project');
    });
  }

  deleteProject(id: string): void {
    const linkedTranscriptSetId = this.transcriptSetIdByProjectId.get(id) ?? null;
    if (linkedTranscriptSetId) {
      const linkedDraft = this.transcriptFlowDrafts.find((draft) => draft.transcriptSetId === linkedTranscriptSetId);
      if (linkedDraft) {
        linkedDraft.projectId = null;
      }
      this.transcriptSetIdByProjectId.delete(id);
    }
    this.projects = this.projects.filter(p => p.id !== id);
    this.bg(async () => {
      if (linkedTranscriptSetId) {
        const unlinkRes = await supabase
          .from('transcript_sets')
          .update({ project_id: null, updated_at: new Date().toISOString() })
          .eq('id', linkedTranscriptSetId);
        if (unlinkRes.error && !isTranscriptTableMissing(unlinkRes.error.message, 'transcript_sets')) {
          this.assertNoError(unlinkRes, 'unlink transcript_set project');
        }
      }
      // Cascade delete handled by DB foreign keys
      const res = await supabase.from('projects').delete().eq('id', id);
      this.assertNoError(res, 'delete project');
    });
  }

  /* Node operations */

  addNode(projectId: string, node: PromptNode): void {
    const p = this.getProject(projectId);
    if (!p) return;
    const normalizedType = toNodeType(node.type);
    const normalizedLabel = normalizeNodeIdentityLabel(node.label, normalizedType);
    node.label = normalizedLabel;
    node.type = normalizedType;
    p.nodes.push(node);
    p.lastEdited = 'Just now';
    this.syncTranscriptDraftCacheFromProject(p);
    this.bg(async () => {
      const nodeInsertRes = await supabase.from('prompt_nodes').insert({
        id: node.id,
        project_id: projectId,
        type: node.type,
        label: node.label,
        icon: node.icon,
        x: node.x,
        y: node.y,
        content: node.content,
        meta: node.meta,
        sort_order: p.nodes.length - 1,
      });
      this.assertNoError(nodeInsertRes, 'insert prompt_node');
      await this.upsertPromptNodeSyncMeta(node);
      const projectUpdateRes = await supabase.from('projects').update({ last_edited: 'Just now' }).eq('id', projectId);
      this.assertNoError(projectUpdateRes, 'touch project last_edited');
    });
  }

  updateNode(projectId: string, nodeId: string, updates: Partial<PromptNode>): void {
    const p = this.getProject(projectId);
    if (!p) return;
    const n = p.nodes.find(n => n.id === nodeId);
    if (!n) return;
    const mergedUpdates: Partial<PromptNode> = { ...updates };
    if (mergedUpdates.label !== undefined || mergedUpdates.type !== undefined) {
      const nextType = mergedUpdates.type !== undefined ? toNodeType(mergedUpdates.type) : n.type;
      const nextLabel = mergedUpdates.label !== undefined ? mergedUpdates.label : n.label;
      const unifiedLabel = normalizeNodeIdentityLabel(nextLabel, nextType);
      mergedUpdates.label = unifiedLabel;
      mergedUpdates.type = nextType;
    }
    Object.assign(n, mergedUpdates);
    p.lastEdited = 'Just now';
    this.syncTranscriptDraftCacheFromProject(p);
    this.bg(async () => {
      // Map model field names to DB column names
      const dbUpdates: PromptNodeUpdate = {};
      if (mergedUpdates.type !== undefined) dbUpdates.type = mergedUpdates.type;
      if (mergedUpdates.label !== undefined) dbUpdates.label = mergedUpdates.label;
      if (mergedUpdates.icon !== undefined) dbUpdates.icon = mergedUpdates.icon;
      if (mergedUpdates.x !== undefined) dbUpdates.x = mergedUpdates.x;
      if (mergedUpdates.y !== undefined) dbUpdates.y = mergedUpdates.y;
      if (mergedUpdates.content !== undefined) dbUpdates.content = mergedUpdates.content;
      if (mergedUpdates.meta !== undefined) dbUpdates.meta = mergedUpdates.meta;
      if (Object.keys(dbUpdates).length > 0) {
        const nodeUpdateRes = await supabase.from('prompt_nodes').update(dbUpdates).eq('id', nodeId);
        this.assertNoError(nodeUpdateRes, 'update prompt_node');
      }
      await this.upsertPromptNodeSyncMeta(n);
      const projectUpdateRes = await supabase.from('projects').update({ last_edited: 'Just now' }).eq('id', projectId);
      this.assertNoError(projectUpdateRes, 'touch project last_edited');
    });
  }

  removeNode(projectId: string, nodeId: string): void {
    const p = this.getProject(projectId);
    if (!p) return;
    p.nodes = p.nodes.filter(n => n.id !== nodeId);
    p.connections = p.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
    p.lastEdited = 'Just now';
    this.syncTranscriptDraftCacheFromProject(p);
    this.bg(async () => {
      await this.deletePromptNodeSyncMeta(nodeId);
      // Connections cascade via FK on delete
      const nodeDeleteRes = await supabase.from('prompt_nodes').delete().eq('id', nodeId);
      this.assertNoError(nodeDeleteRes, 'delete prompt_node');
      const projectUpdateRes = await supabase.from('projects').update({ last_edited: 'Just now' }).eq('id', projectId);
      this.assertNoError(projectUpdateRes, 'touch project last_edited');
    });
  }

  /* Connection operations */

  addConnection(projectId: string, from: string, to: string, label = ''): void {
    const p = this.getProject(projectId);
    if (!p) return;
    if (p.connections.some(c => c.from === from && c.to === to)) return;
    const normalizedLabel = normalizeConnectionLabel(label);
    const conn: Connection = normalizedLabel
      ? { id: uid(), from, to, label: normalizedLabel }
      : { id: uid(), from, to };
    p.connections.push(conn);
    this.syncTranscriptDraftCacheFromProject(p);
    this.bg(async () => {
      await this.insertConnectionRemote(projectId, conn);
    });
  }

  updateConnectionLabel(projectId: string, connectionId: string, label: string): void {
    const p = this.getProject(projectId);
    if (!p) return;
    const connection = p.connections.find((item) => item.id === connectionId);
    if (!connection) return;

    const normalizedLabel = normalizeConnectionLabel(label);
    if (normalizedLabel) {
      connection.label = normalizedLabel;
    } else {
      delete connection.label;
    }
    this.syncTranscriptDraftCacheFromProject(p);

    this.bg(async () => {
      const connectionUpdateRes = await supabase
        .from('connections')
        .update({ label: normalizedLabel })
        .eq('id', connectionId);
      if (!connectionUpdateRes.error) {
        return;
      }
      if (isConnectionLabelColumnMissing(connectionUpdateRes.error.message)) {
        return;
      }
      this.assertNoError(connectionUpdateRes, 'update connection');
    });
  }

  removeConnection(projectId: string, connectionId: string): void {
    const p = this.getProject(projectId);
    if (!p) return;
    p.connections = p.connections.filter(c => c.id !== connectionId);
    this.syncTranscriptDraftCacheFromProject(p);
    this.bg(async () => {
      const connDeleteRes = await supabase.from('connections').delete().eq('id', connectionId);
      this.assertNoError(connDeleteRes, 'delete connection');
    });
  }

  /* Version / diff operations */

  saveVersion(
    projectId: string,
    content: string,
    notes: string,
    snapshot?: PromptGraphSnapshot | null,
  ): PromptVersion {
    const p = this.getProject(projectId);
    const normalizedNotes = notes.trim() || 'Snapshot';
    const snapshotToPersist = snapshot === undefined
      ? (p ? createGraphSnapshot(p) : null)
      : snapshot;
    const ver: PromptVersion = {
      id: uid(),
      timestamp: Date.now(),
      content,
      notes: normalizedNotes,
      snapshot: snapshotToPersist,
    };
    if (p) {
      p.versions.push(ver);
      this.syncTranscriptDraftCacheFromProject(p);
      this.bg(async () => {
        const versionInsertRes = await supabase.from('prompt_versions').insert({
          id: ver.id,
          project_id: projectId,
          timestamp: ver.timestamp,
          content: ver.content,
          notes: ver.notes,
          snapshot_json: ver.snapshot,
        });
        this.assertNoError(versionInsertRes, 'insert prompt_version');
        await this.persistTranscriptFlowSnapshot(projectId, p, ver.id);
      });
    }
    return ver;
  }

  saveAssembledVersion(projectId: string, notes: string, mode: PromptAssemblyMode = 'runtime'): PromptVersion | null {
    const p = this.getProject(projectId);
    if (!p) return null;

    const assembled = this.assemblePrompt(projectId, mode);
    const snapshot = createGraphSnapshot(p);
    const latest = p.versions[p.versions.length - 1];
    if (latest && latest.content === assembled && sameGraphSnapshot(latest.snapshot, snapshot)) {
      return null;
    }

    return this.saveVersion(projectId, assembled, notes, snapshot);
  }

  saveCurrentState(projectId: string, mode: PromptAssemblyMode = 'runtime'): PromptVersion | null {
    const p = this.getProject(projectId);
    if (!p) return null;
    const nextSnapshotNumber = p.versions.length + 1;
    return this.saveAssembledVersion(projectId, `Snapshot ${nextSnapshotNumber}`, mode);
  }

  getVersions(projectId: string): PromptVersion[] {
    return this.getProject(projectId)?.versions ?? [];
  }

  /* Assembled prompt */

  assemblePrompt(projectId: string, mode: PromptAssemblyMode = 'runtime'): string {
    const p = this.getProject(projectId);
    if (!p) return '';
    const plan = buildGraphAssemblyPlan(p);
    if (mode === 'runtime') {
      return plan.orderedNodes.map((node) => node.content).join('\n\n');
    }
    return assembleFlowTemplate(p, plan);
  }

  assembleRuntimePrompt(projectId: string): string {
    return this.assemblePrompt(projectId, 'runtime');
  }

  assembleFlowTemplate(projectId: string): string {
    return this.assemblePrompt(projectId, 'flow-template');
  }

  persist(): void {
    this.saveLocalStorage();
  }

  private async persistTranscriptFlowSnapshot(projectId: string, project: Project, promptVersionId: string): Promise<void> {
    const transcriptSetId = this.transcriptSetIdByProjectId.get(projectId);
    if (!transcriptSetId) return;

    const transcriptSelectRes = await supabase
      .from('transcripts')
      .select('id')
      .eq('transcript_set_id', transcriptSetId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (transcriptSelectRes.error) {
      if (isTranscriptTableMissing(transcriptSelectRes.error.message, 'transcripts')) return;
      this.assertNoError(transcriptSelectRes, 'fetch transcript for snapshot');
    }

    let transcriptId = transcriptSelectRes.data?.[0]?.id ?? null;
    if (!transcriptId) {
      const transcriptInsertRes = await supabase
        .from('transcripts')
        .insert({
          transcript_set_id: transcriptSetId,
          title: `${project.name} Canvas Snapshot @ ${new Date().toISOString()}`,
          transcript_text: 'Canvas edits snapshot generated from transcript flow project.',
          metadata: {
            source: 'canvas-edit',
            projectId,
          },
        })
        .select('id')
        .single();
      if (transcriptInsertRes.error) {
        if (isTranscriptTableMissing(transcriptInsertRes.error.message, 'transcripts')) return;
        this.assertNoError(transcriptInsertRes, 'insert transcript snapshot');
      }
      transcriptId = transcriptInsertRes.data?.id ?? null;
    }

    if (!transcriptId) return;

    const flowInsertRes = await supabase
      .from('transcript_flows')
      .insert({
        transcript_id: transcriptId,
        prompt_version_id: promptVersionId,
        model: project.model,
        flow_title: project.name,
        flow_summary: project.description,
        nodes_json: project.nodes.map((node) => ({
          id: node.id,
          label: node.label,
          type: node.type,
          icon: node.icon,
          content: node.content,
          meta: node.meta,
        })),
        connections_json: project.connections.map((connection) => ({
          from: connection.from,
          to: connection.to,
          reason: normalizeConnectionLabel(connection.label),
        })),
        used_fallback: false,
        warning: '',
      });
    if (flowInsertRes.error && isTranscriptTableMissing(flowInsertRes.error.message, 'transcript_flows')) {
      return;
    }
    this.assertNoError(flowInsertRes, 'insert transcript_flow snapshot');
  }

  private async upsertPromptNodeSyncMeta(node: PromptNode): Promise<void> {
    const syncRes = await supabase
      .from('prompt_node_sync_meta')
      .upsert({
        prompt_node_id: node.id,
        section_hash: buildPromptNodeSectionHash(node),
        last_assembled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    if (syncRes.error && isPromptNodeSyncMetaTableMissing(syncRes.error.message)) {
      return;
    }
    this.assertNoError(syncRes, 'upsert prompt_node_sync_meta');
  }

  private async deletePromptNodeSyncMeta(nodeId: string): Promise<void> {
    const deleteRes = await supabase
      .from('prompt_node_sync_meta')
      .delete()
      .eq('prompt_node_id', nodeId);
    if (deleteRes.error && isPromptNodeSyncMetaTableMissing(deleteRes.error.message)) {
      return;
    }
    this.assertNoError(deleteRes, 'delete prompt_node_sync_meta');
  }

  private async insertCustomNodeRemote(template: CustomNodeTemplate): Promise<void> {
    const insertRes = await supabase.from('custom_nodes').insert({
      id: template.id,
      owner_id: this.currentUserId ?? undefined,
      type: template.type,
      label: template.label,
      icon: template.icon,
      content: template.content,
      meta: template.meta,
      created_at: template.createdAt,
      updated_at: template.updatedAt,
    });
    if (insertRes.error && isCustomNodesTableMissing(insertRes.error.message)) {
      return;
    }
    this.assertNoError(insertRes, 'insert custom_node');
  }

  private async insertConnectionRemote(projectId: string, connection: Connection): Promise<void> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const connectionInsertBase = {
        id: connection.id,
        project_id: projectId,
        from_node_id: connection.from,
        to_node_id: connection.to,
      };
      const connectionInsertWithLabel = {
        ...connectionInsertBase,
        label: normalizeConnectionLabel(connection.label),
      };

      let connInsertRes = await supabase.from('connections').insert(connectionInsertWithLabel);
      if (connInsertRes.error && isConnectionLabelColumnMissing(connInsertRes.error.message)) {
        connInsertRes = await supabase.from('connections').insert(connectionInsertBase);
      }

      if (!connInsertRes.error) {
        return;
      }

      const message = connInsertRes.error.message;
      const isForeignKeyRace = isConnectionForeignKeyViolation(message);
      const isLastAttempt = attempt === maxAttempts;

      if (!isForeignKeyRace || isLastAttempt) {
        this.assertNoError(connInsertRes, 'insert connection');
        return;
      }

      await delay(120 * attempt);
    }
  }
}

function assembleFlowTemplate(project: Pick<Project, 'nodes' | 'connections'>, plan: GraphAssemblyPlan): string {
  const nodeById = new Map<string, PromptNode>(project.nodes.map((node) => [node.id, node]));
  const sections = plan.orderedNodes.map((node, index) => {
    const sectionLines: string[] = [`## ${index + 1}. ${node.label}`];
    sectionLines.push(node.content.trim() ? node.content : '(empty node content)');

    const incoming = plan.incomingByTo.get(node.id) ?? [];
    if (incoming.length > 1) {
      const mergeSources = incoming.map((edge) => {
        const sourceNode = nodeById.get(edge.from);
        const sourceLabel = sourceNode ? sourceNode.label : edge.from;
        const branchLabel = normalizeConnectionLabel(edge.label);
        return branchLabel ? `${sourceLabel} [${branchLabel}]` : sourceLabel;
      });
      sectionLines.push(`Merge Inputs: ${mergeSources.join(', ')}`);
    }

    const outgoing = plan.outgoingByFrom.get(node.id) ?? [];
    if (outgoing.length === 0) {
      sectionLines.push('Next: [end]');
    } else if (outgoing.length === 1) {
      sectionLines.push(`Next: ${formatConnectionTarget(outgoing[0], nodeById)}`);
    } else {
      sectionLines.push('Branches:');
      for (const edge of outgoing) {
        sectionLines.push(`- ${formatConnectionTarget(edge, nodeById)}`);
      }
    }

    return sectionLines.join('\n');
  });

  const headerLines = [
    '# Prompt Flow Template',
    'This assembled prompt preserves branch and merge structure from the node graph.',
  ];
  if (plan.hasCycle) {
    headerLines.push('Warning: cycle detected. Nodes in cycle were appended using canvas order.');
  }
  return `${headerLines.join('\n\n')}\n\n${sections.join('\n\n')}`;
}

function toTypedRows<T>(
  rows: readonly unknown[] | null,
  isRow: (value: unknown) => value is T,
  tableName: string,
): T[] {
  if (!rows) return [];
  const typedRows: T[] = [];
  for (const row of rows) {
    if (!isRow(row)) {
      throw new Error(`Invalid row returned by ${tableName}`);
    }
    typedRows.push(row);
  }
  return typedRows;
}

function toPromptNode(row: PromptNodeRow): PromptNode {
  const normalizedLabel = normalizeNodeIdentityLabel(row.label, row.type);
  return {
    id: row.id,
    type: normalizedLabel as NodeType,
    label: normalizedLabel,
    icon: row.icon,
    x: row.x,
    y: row.y,
    content: row.content,
    meta: row.meta ?? {},
  };
}

function toCustomNodeTemplate(row: CustomNodeRow): CustomNodeTemplate {
  return {
    id: row.id,
    type: toNodeType(row.type),
    label: normalizeCustomNodeTemplateLabel(row.label),
    icon: row.icon.trim() || 'widgets',
    content: row.content,
    meta: row.meta ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toConnection(row: ConnectionRow): Connection {
  const label = normalizeConnectionLabel(row.label);
  return {
    id: row.id,
    from: row.from_node_id,
    to: row.to_node_id,
    ...(label ? { label } : {}),
  };
}

function toVersion(row: PromptVersionRow): PromptVersion {
  return {
    id: row.id,
    timestamp: row.timestamp,
    content: row.content,
    notes: row.notes,
    snapshot: row.snapshot_json ? toPromptGraphSnapshot(row.snapshot_json) : null,
  };
}

function toPromptGraphSnapshot(snapshot: NonNullable<PromptVersionRow['snapshot_json']>): PromptGraphSnapshot {
  return {
    nodes: snapshot.nodes.map((node) => {
      const normalizedLabel = normalizeNodeIdentityLabel(node.label, node.type);
      return {
        id: node.id,
        type: normalizedLabel as NodeType,
        label: normalizedLabel,
        icon: node.icon,
        x: node.x,
        y: node.y,
        content: node.content,
        meta: node.meta,
      };
    }),
    connections: snapshot.connections.map((connection) => {
      const label = normalizeConnectionLabel(connection.label);
      return {
        id: connection.id,
        from: connection.from,
        to: connection.to,
        ...(label ? { label } : {}),
      };
    }),
  };
}

function createGraphSnapshot(project: Pick<Project, 'nodes' | 'connections'>): PromptGraphSnapshot {
  return {
    nodes: project.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      icon: node.icon,
      x: node.x,
      y: node.y,
      content: node.content,
      meta: { ...node.meta },
    })),
    connections: project.connections.map((connection) => {
      const label = normalizeConnectionLabel(connection.label);
      return {
        id: connection.id,
        from: connection.from,
        to: connection.to,
        ...(label ? { label } : {}),
      };
    }),
  };
}

function sameGraphSnapshot(a: PromptGraphSnapshot | null, b: PromptGraphSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return stableSnapshotKey(a) === stableSnapshotKey(b);
}

function stableSnapshotKey(snapshot: PromptGraphSnapshot): string {
  const normalizedNodes = snapshot.nodes
    .map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      icon: node.icon,
      x: node.x,
      y: node.y,
      content: node.content,
      meta: Object.fromEntries(Object.entries(node.meta).sort(([left], [right]) => left.localeCompare(right))),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const normalizedConnections = snapshot.connections
    .map((connection) => ({
      id: connection.id,
      from: connection.from,
      to: connection.to,
      label: normalizeConnectionLabel(connection.label),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return JSON.stringify({ nodes: normalizedNodes, connections: normalizedConnections });
}

function groupByProjectId<T extends { project_id: string }>(items: T[]): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const item of items) {
    const k = item.project_id;
    if (!map[k]) map[k] = [];
    map[k].push(item);
  }
  return map;
}

function toNodeType(value: string): NodeType {
  return isNodeType(value) ? value : 'custom';
}

function cloneTranscriptFlowDraft(draft: TranscriptFlowDraft): TranscriptFlowDraft {
  return {
    transcriptSetId: draft.transcriptSetId,
    projectId: draft.projectId,
    name: draft.name,
    description: draft.description,
    source: draft.source,
    updatedAt: draft.updatedAt,
    latestFlow: draft.latestFlow
      ? {
        transcriptFlowId: draft.latestFlow.transcriptFlowId,
        transcriptId: draft.latestFlow.transcriptId,
        createdAt: draft.latestFlow.createdAt,
        model: draft.latestFlow.model,
        flowTitle: draft.latestFlow.flowTitle,
        flowSummary: draft.latestFlow.flowSummary,
        usedFallback: draft.latestFlow.usedFallback,
        warning: draft.latestFlow.warning,
        nodeCount: draft.latestFlow.nodeCount,
        connectionCount: draft.latestFlow.connectionCount,
        nodesJson: draft.latestFlow.nodesJson.map((item) => cloneUnknownJson(item)),
        connectionsJson: draft.latestFlow.connectionsJson.map((item) => cloneUnknownJson(item)),
      }
      : null,
  };
}

function cloneUnknownJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneUnknownJson(entry));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneUnknownJson(entry)]));
}

function compareTranscriptDraftRecency(left: TranscriptFlowDraft, right: TranscriptFlowDraft): number {
  const leftTs = Date.parse(left.latestFlow?.createdAt ?? left.updatedAt);
  const rightTs = Date.parse(right.latestFlow?.createdAt ?? right.updatedAt);
  const safeLeft = Number.isFinite(leftTs) ? leftTs : 0;
  const safeRight = Number.isFinite(rightTs) ? rightTs : 0;
  return safeRight - safeLeft;
}

function transcriptFlowResultToDraftDetail(
  flow: TranscriptFlowResult,
  transcriptFlowId: string,
  createdAt: string,
): TranscriptFlowDraftDetail {
  return {
    transcriptFlowId,
    transcriptId: '',
    createdAt,
    model: flow.model,
    flowTitle: flow.title,
    flowSummary: flow.summary,
    usedFallback: flow.usedFallback,
    warning: flow.warning ?? '',
    nodeCount: flow.nodes.length,
    connectionCount: flow.connections.length,
    nodesJson: flow.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      icon: resolveNodeIcon(node.icon, node.type),
      content: node.content,
      meta: { ...node.meta },
    })),
    connectionsJson: flow.connections.map((connection) => ({
      from: connection.from,
      to: connection.to,
      reason: normalizeConnectionLabel(connection.reason),
    })),
  };
}

function projectToTranscriptDraftDetail(
  project: Project,
  createdAt: string,
  transcriptFlowId = uid(),
  transcriptId = '',
): TranscriptFlowDraftDetail {
  return {
    transcriptFlowId,
    transcriptId,
    createdAt,
    model: project.model,
    flowTitle: project.name,
    flowSummary: project.description,
    usedFallback: false,
    warning: '',
    nodeCount: project.nodes.length,
    connectionCount: project.connections.length,
    nodesJson: project.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      icon: node.icon,
      content: node.content,
      meta: { ...node.meta },
    })),
    connectionsJson: project.connections.map((connection) => ({
      from: connection.from,
      to: connection.to,
      reason: normalizeConnectionLabel(connection.label),
    })),
  };
}

function toTranscriptFlowDraftDetail(row: TranscriptFlowRow): TranscriptFlowDraftDetail {
  const nodesJson = Array.isArray(row.nodes_json) ? row.nodes_json : [];
  const connectionsJson = Array.isArray(row.connections_json) ? row.connections_json : [];
  return {
    transcriptFlowId: row.id,
    transcriptId: row.transcript_id,
    createdAt: row.created_at,
    model: row.model,
    flowTitle: row.flow_title,
    flowSummary: row.flow_summary,
    usedFallback: row.used_fallback,
    warning: row.warning,
    nodeCount: nodesJson.length,
    connectionCount: connectionsJson.length,
    nodesJson,
    connectionsJson,
  };
}

function parseStoredTranscriptNodes(nodesJson: unknown[]): ParsedTranscriptNodeSeed[] {
  const parsed: ParsedTranscriptNodeSeed[] = [];
  const usedIds = new Set<string>();

  nodesJson.forEach((rawNode, index) => {
    if (!isRecord(rawNode)) return;

    const candidateId = typeof rawNode.id === 'string' ? rawNode.id.trim() : '';
    const fallbackId = `node_${index + 1}`;
    let sourceId = candidateId || fallbackId;
    let duplicateCounter = 2;
    while (usedIds.has(sourceId)) {
      sourceId = `${sourceId}_${duplicateCounter}`;
      duplicateCounter += 1;
    }
    usedIds.add(sourceId);

    const candidateType = typeof rawNode.type === 'string' ? rawNode.type : 'custom';
    const type = toNodeType(candidateType);
    const candidateLabel = typeof rawNode.label === 'string' ? rawNode.label : '';
    const label = normalizeNodeIdentityLabel(candidateLabel, type);
    const candidateIcon = typeof rawNode.icon === 'string' ? rawNode.icon : '';
    const content = typeof rawNode.content === 'string' ? rawNode.content : label;
    const meta = toStringRecord(rawNode.meta);

    parsed.push({
      sourceId,
      type,
      label,
      icon: resolveNodeIcon(candidateIcon, type),
      content,
      meta,
    });
  });

  return parsed;
}

function parseStoredTranscriptConnections(
  connectionsJson: unknown[],
  validNodeIds: ReadonlySet<string>,
): ParsedTranscriptConnectionSeed[] {
  const parsed: ParsedTranscriptConnectionSeed[] = [];
  const seen = new Set<string>();

  for (const rawConnection of connectionsJson) {
    if (!isRecord(rawConnection)) continue;
    const from = typeof rawConnection.from === 'string' ? rawConnection.from.trim() : '';
    const to = typeof rawConnection.to === 'string' ? rawConnection.to.trim() : '';
    if (!from || !to || from === to) continue;
    if (!validNodeIds.has(from) || !validNodeIds.has(to)) continue;
    const dedupeKey = `${from}->${to}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const reasonCandidate = typeof rawConnection.reason === 'string'
      ? rawConnection.reason
      : (typeof rawConnection.label === 'string' ? rawConnection.label : '');
    parsed.push({
      from,
      to,
      label: normalizeConnectionLabel(reasonCandidate),
    });
  }

  return parsed;
}

function computeTranscriptSeedLayout(
  nodes: ParsedTranscriptNodeSeed[],
  connections: ParsedTranscriptConnectionSeed[],
): Record<string, { x: number; y: number }> {
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const levelByNode = new Map<string, number>();

  for (const node of nodes) {
    incomingCount.set(node.sourceId, 0);
    outgoing.set(node.sourceId, []);
  }

  for (const connection of connections) {
    outgoing.get(connection.from)?.push(connection.to);
    incomingCount.set(connection.to, (incomingCount.get(connection.to) ?? 0) + 1);
  }

  const queue = nodes
    .filter((node) => (incomingCount.get(node.sourceId) ?? 0) === 0)
    .map((node) => node.sourceId);
  if (queue.length === 0 && nodes.length > 0) {
    queue.push(nodes[0].sourceId);
  }

  for (const sourceId of queue) {
    levelByNode.set(sourceId, 0);
  }

  while (queue.length > 0) {
    const sourceId = queue.shift() ?? '';
    const sourceLevel = levelByNode.get(sourceId) ?? 0;
    const targets = outgoing.get(sourceId) ?? [];
    for (const targetId of targets) {
      if (levelByNode.has(targetId)) continue;
      levelByNode.set(targetId, sourceLevel + 1);
      queue.push(targetId);
    }
  }

  const maxLevel = levelByNode.size > 0 ? Math.max(...Array.from(levelByNode.values())) : 0;
  for (const node of nodes) {
    if (!levelByNode.has(node.sourceId)) {
      levelByNode.set(node.sourceId, maxLevel);
    }
  }

  const grouped = new Map<number, ParsedTranscriptNodeSeed[]>();
  for (const node of nodes) {
    const level = levelByNode.get(node.sourceId) ?? 0;
    const group = grouped.get(level) ?? [];
    group.push(node);
    grouped.set(level, group);
  }

  const layout: Record<string, { x: number; y: number }> = {};
  const levels = Array.from(grouped.keys()).sort((left, right) => left - right);
  const startX = 80;
  const startY = 80;
  const xGap = 340;
  const yGap = 200;

  for (const level of levels) {
    const nodesAtLevel = grouped.get(level) ?? [];
    nodesAtLevel.forEach((node, index) => {
      layout[node.sourceId] = {
        x: startX + level * xGap,
        y: startY + index * yGap,
      };
    });
  }

  return layout;
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => typeof entry === 'string')
      .map(([key, entry]) => [key, (entry as string).trim()])
      .filter(([, entry]) => entry.length > 0),
  );
}

interface GraphAssemblyPlan {
  orderedNodes: PromptNode[];
  outgoingByFrom: Map<string, Connection[]>;
  incomingByTo: Map<string, Connection[]>;
  hasCycle: boolean;
}

function buildGraphAssemblyPlan(project: Pick<Project, 'nodes' | 'connections'>): GraphAssemblyPlan {
  const nodeById = new Map(project.nodes.map((node) => [node.id, node]));
  const nodeOrder = new Map(project.nodes.map((node, index) => [node.id, index]));
  const outgoingByFrom = new Map<string, Connection[]>();
  const incomingByTo = new Map<string, Connection[]>();
  const inDegree = new Map<string, number>();

  for (const node of project.nodes) {
    outgoingByFrom.set(node.id, []);
    incomingByTo.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const connection of project.connections) {
    if (!nodeById.has(connection.from) || !nodeById.has(connection.to)) continue;
    outgoingByFrom.get(connection.from)!.push(connection);
    incomingByTo.get(connection.to)!.push(connection);
    inDegree.set(connection.to, (inDegree.get(connection.to) ?? 0) + 1);
  }

  const compareNodeOrder = (leftNodeId: string, rightNodeId: string): number => {
    return (nodeOrder.get(leftNodeId) ?? Number.MAX_SAFE_INTEGER) - (nodeOrder.get(rightNodeId) ?? Number.MAX_SAFE_INTEGER);
  };

  const compareOutgoingConnections = (left: Connection, right: Connection): number => {
    const labelCompare = normalizeConnectionLabel(left.label).localeCompare(normalizeConnectionLabel(right.label));
    if (labelCompare !== 0) return labelCompare;
    const targetCompare = compareNodeOrder(left.to, right.to);
    if (targetCompare !== 0) return targetCompare;
    return left.id.localeCompare(right.id);
  };

  const compareIncomingConnections = (left: Connection, right: Connection): number => {
    const sourceCompare = compareNodeOrder(left.from, right.from);
    if (sourceCompare !== 0) return sourceCompare;
    const labelCompare = normalizeConnectionLabel(left.label).localeCompare(normalizeConnectionLabel(right.label));
    if (labelCompare !== 0) return labelCompare;
    return left.id.localeCompare(right.id);
  };

  outgoingByFrom.forEach((connections) => connections.sort(compareOutgoingConnections));
  incomingByTo.forEach((connections) => connections.sort(compareIncomingConnections));

  const ready = project.nodes
    .filter((node) => (inDegree.get(node.id) ?? 0) === 0)
    .sort((left, right) => compareNodeOrder(left.id, right.id));

  const orderedNodes: PromptNode[] = [];
  while (ready.length > 0) {
    const nextNode = ready.shift()!;
    orderedNodes.push(nextNode);
    const outgoingConnections = outgoingByFrom.get(nextNode.id) ?? [];
    for (const connection of outgoingConnections) {
      const nextDegree = (inDegree.get(connection.to) ?? 0) - 1;
      inDegree.set(connection.to, nextDegree);
      if (nextDegree === 0) {
        const targetNode = nodeById.get(connection.to);
        if (targetNode) {
          ready.push(targetNode);
        }
      }
    }
    ready.sort((left, right) => compareNodeOrder(left.id, right.id));
  }

  let hasCycle = false;
  if (orderedNodes.length !== project.nodes.length) {
    hasCycle = true;
    const orderedIds = new Set(orderedNodes.map((node) => node.id));
    const remainingNodes = project.nodes
      .filter((node) => !orderedIds.has(node.id))
      .sort((left, right) => compareNodeOrder(left.id, right.id));
    orderedNodes.push(...remainingNodes);
  }

  return { orderedNodes, outgoingByFrom, incomingByTo, hasCycle };
}

function formatConnectionTarget(connection: Connection, nodeById: Map<string, PromptNode>): string {
  const targetNode = nodeById.get(connection.to);
  const targetLabel = targetNode ? targetNode.label : connection.to;
  const branchLabel = normalizeConnectionLabel(connection.label);
  return branchLabel ? `[${branchLabel}] -> ${targetLabel}` : `-> ${targetLabel}`;
}

function normalizeConnectionLabel(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeCustomNodeTemplateLabel(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.slice(0, 80) || 'Custom Node';
}

function normalizeNodeIdentityLabel(
  labelValue: string | null | undefined,
  typeValue?: string | null,
): string {
  const normalizedLabel = typeof labelValue === 'string' ? labelValue.trim() : '';
  if (normalizedLabel.length > 0) return normalizedLabel;
  const normalizedType = typeof typeValue === 'string' ? typeValue.trim() : '';
  if (normalizedType.length > 0) return normalizedType;
  return 'N/A';
}

function isNodeType(value: string): value is NodeType {
  switch (value) {
    case 'core-persona':
    case 'mission-objective':
    case 'tone-guidelines':
    case 'language-model':
    case 'logic-branch':
    case 'termination':
    case 'vector-db':
    case 'static-context':
    case 'memory-buffer':
    case 'webhook':
    case 'transcriber':
    case 'llm-brain':
    case 'voice-synth':
    case 'style-module':
    case 'custom':
      return true;
    default:
      return false;
  }
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = Reflect.get(err, 'message');
    return typeof message === 'string' ? message : String(message ?? '');
  }
  return String(err ?? '');
}

function getPersistenceHint(errorMessage: string): string | null {
  const message = errorMessage.toLowerCase();
  if (message.includes('no authenticated session')) {
    return 'Sign in to your account to enable per-user cloud sync.';
  }
  if (message.includes('anonymous sign-ins are disabled')) {
    return 'Enable Anonymous auth in Supabase Dashboard -> Authentication -> Providers -> Anonymous.';
  }
  if (message.includes('row-level security policy')) {
    return 'Check RLS policies and ensure you are authenticated before inserts.';
  }
  if (message.includes('connections_from_node_id_fkey') || message.includes('connections_to_node_id_fkey')) {
    return 'A node was referenced before its insert completed. The app now retries and queues writes; reload and try again.';
  }
  return null;
}

function isConnectionForeignKeyViolation(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('connections_from_node_id_fkey') || normalized.includes('connections_to_node_id_fkey');
}

function isConnectionLabelColumnMissing(message: string): boolean {
  const normalized = message.toLowerCase();
  if (!normalized.includes('label')) return false;
  return normalized.includes('connections') && (normalized.includes('does not exist') || normalized.includes('schema cache'));
}

function isCustomNodesTableMissing(message: string): boolean {
  const normalized = message.toLowerCase();
  if (!normalized.includes('custom_nodes')) return false;
  return normalized.includes('does not exist') || normalized.includes('schema cache');
}

function isTranscriptTableMissing(message: string, tableName: string): boolean {
  const normalized = message.toLowerCase();
  if (!normalized.includes(tableName.toLowerCase())) return false;
  return normalized.includes('does not exist') || normalized.includes('schema cache');
}

function isPromptNodeSyncMetaTableMissing(message: string): boolean {
  const normalized = message.toLowerCase();
  if (!normalized.includes('prompt_node_sync_meta')) return false;
  return normalized.includes('does not exist') || normalized.includes('schema cache');
}

function buildPromptNodeSectionHash(node: Pick<PromptNode, 'id' | 'type' | 'label' | 'icon' | 'content'>): string {
  const payload = `${node.id}|${node.type}|${node.label}|${node.icon}|${node.content}`;
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a_${(hash >>> 0).toString(16)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isProjectRow(value: unknown): value is ProjectRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    (typeof value.owner_id === 'string' || value.owner_id === null) &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.model === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.last_edited === 'string' &&
    typeof value.created_at === 'string'
  );
}

function isPromptNodeRow(value: unknown): value is PromptNodeRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.project_id === 'string' &&
    typeof value.type === 'string' &&
    typeof value.label === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.content === 'string' &&
    isStringRecord(value.meta) &&
    typeof value.sort_order === 'number' &&
    typeof value.created_at === 'string'
  );
}

function isConnectionRow(value: unknown): value is ConnectionRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.project_id === 'string' &&
    typeof value.from_node_id === 'string' &&
    typeof value.to_node_id === 'string' &&
    (value.label === undefined || typeof value.label === 'string') &&
    typeof value.created_at === 'string'
  );
}

function isPromptVersionRow(value: unknown): value is PromptVersionRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.project_id === 'string' &&
    typeof value.timestamp === 'number' &&
    typeof value.content === 'string' &&
    typeof value.notes === 'string' &&
    (value.snapshot_json === null || isPromptGraphSnapshot(value.snapshot_json)) &&
    typeof value.created_at === 'string'
  );
}

function isCustomNodeRow(value: unknown): value is CustomNodeRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.owner_id === 'string' &&
    typeof value.type === 'string' &&
    typeof value.label === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.content === 'string' &&
    isStringRecord(value.meta) &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function isTranscriptSetRow(value: unknown): value is TranscriptSetRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.owner_id === 'string' &&
    (typeof value.project_id === 'string' || value.project_id === null) &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.source === 'string' &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}

function isTranscriptRow(value: unknown): value is TranscriptRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.transcript_set_id === 'string' &&
    typeof value.external_id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.transcript_text === 'string' &&
    isRecord(value.metadata) &&
    typeof value.ingested_at === 'string' &&
    typeof value.created_at === 'string'
  );
}

function isTranscriptFlowRow(value: unknown): value is TranscriptFlowRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.transcript_id === 'string' &&
    (typeof value.prompt_version_id === 'string' || value.prompt_version_id === null) &&
    typeof value.model === 'string' &&
    typeof value.flow_title === 'string' &&
    typeof value.flow_summary === 'string' &&
    Array.isArray(value.nodes_json) &&
    Array.isArray(value.connections_json) &&
    typeof value.used_fallback === 'boolean' &&
    typeof value.warning === 'string' &&
    typeof value.created_at === 'string'
  );
}

function isProjectArray(value: unknown): value is Project[] {
  return Array.isArray(value) && value.every(isProject);
}

function isLocalStorePayload(value: unknown): value is LocalStorePayload {
  if (!isRecord(value)) return false;
  const transcriptDrafts = Reflect.get(value, 'transcriptFlowDrafts');
  return (
    Array.isArray(value.projects) &&
    value.projects.every(isProject) &&
    Array.isArray(value.customNodeTemplates) &&
    value.customNodeTemplates.every(isCustomNodeTemplate) &&
    (transcriptDrafts === undefined ||
      (Array.isArray(transcriptDrafts) && transcriptDrafts.every(isTranscriptFlowDraft)))
  );
}

function isProject(value: unknown): value is Project {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.model === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.lastEdited === 'string' &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isPromptNode) &&
    Array.isArray(value.connections) &&
    value.connections.every(isConnection) &&
    Array.isArray(value.versions) &&
    value.versions.every(isPromptVersion)
  );
}

function isPromptNode(value: unknown): value is PromptNode {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    typeof value.label === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.content === 'string' &&
    isStringRecord(value.meta)
  );
}

function isConnection(value: unknown): value is Connection {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.from === 'string' &&
    typeof value.to === 'string' &&
    (value.label === undefined || typeof value.label === 'string')
  );
}

function isPromptVersion(value: unknown): value is PromptVersion {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.timestamp === 'number' &&
    typeof value.content === 'string' &&
    typeof value.notes === 'string' &&
    (value.snapshot === undefined || value.snapshot === null || isPromptGraphSnapshot(value.snapshot))
  );
}

function isTranscriptFlowDraft(value: unknown): value is TranscriptFlowDraft {
  if (!isRecord(value)) return false;
  const latestFlow = Reflect.get(value, 'latestFlow');
  return (
    typeof value.transcriptSetId === 'string' &&
    (typeof value.projectId === 'string' || value.projectId === null) &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.source === 'string' &&
    typeof value.updatedAt === 'string' &&
    (latestFlow === null || latestFlow === undefined || isTranscriptFlowDraftDetail(latestFlow))
  );
}

function isTranscriptFlowDraftDetail(value: unknown): value is TranscriptFlowDraftDetail {
  if (!isRecord(value)) return false;
  return (
    typeof value.transcriptFlowId === 'string' &&
    typeof value.transcriptId === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.model === 'string' &&
    typeof value.flowTitle === 'string' &&
    typeof value.flowSummary === 'string' &&
    typeof value.usedFallback === 'boolean' &&
    typeof value.warning === 'string' &&
    typeof value.nodeCount === 'number' &&
    typeof value.connectionCount === 'number' &&
    Array.isArray(value.nodesJson) &&
    Array.isArray(value.connectionsJson)
  );
}

function isCustomNodeTemplate(value: unknown): value is CustomNodeTemplate {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    isNodeType(value.type) &&
    typeof value.label === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.content === 'string' &&
    isStringRecord(value.meta) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'string');
}

function isPromptGraphSnapshot(value: unknown): value is PromptGraphSnapshot {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.nodes) &&
    value.nodes.every(isPromptSnapshotNode) &&
    Array.isArray(value.connections) &&
    value.connections.every(isConnection)
  );
}

function isPromptSnapshotNode(value: unknown): value is {
  id: string;
  type: string;
  label: string;
  icon: string;
  x: number;
  y: number;
  content: string;
  meta: Record<string, string>;
} {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    typeof value.label === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.content === 'string' &&
    isStringRecord(value.meta)
  );
}

export const store = new Store();




