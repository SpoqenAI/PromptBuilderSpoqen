/**
 * Store — Manages application state backed by Supabase.
 *
 * Strategy: load-on-init into memory; sync reads, async writes.
 * All mutating calls update the in-memory cache immediately (keeping
 * the UI synchronous) and fire a background Supabase call.
 */
import { Project, PromptNode, Connection, PromptVersion, NodeType, uid } from './models';
import type { Database } from './database.types';
import { supabase } from './supabase';

type ProjectRow = Database['public']['Tables']['projects']['Row'];
type PromptNodeRow = Database['public']['Tables']['prompt_nodes']['Row'];
type PromptNodeUpdate = Database['public']['Tables']['prompt_nodes']['Update'];
type ConnectionRow = Database['public']['Tables']['connections']['Row'];
type PromptVersionRow = Database['public']['Tables']['prompt_versions']['Row'];

export type PersistenceMode = 'database' | 'local-fallback';

export interface StorePersistenceStatus {
  mode: PersistenceMode;
  error: string | null;
  hint: string | null;
}

export interface StoreRemoteErrorEventDetail extends StorePersistenceStatus {
  context: string;
}

/* Store state */
class Store {
  private projects: Project[] = [];
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
    this._ready = null;
    this.remoteWriteChain = Promise.resolve();
    this.currentUserId = null;
    this.persistenceStatus = {
      mode: 'database',
      error: null,
      hint: null,
    };
  }

  /* ── Initialisation ───────────────── */

  private async init(): Promise<void> {
    try {
      const userId = await this.ensureSession();

      // 1. Fetch projects
      const { data: rows, error } = await supabase
        .from('projects')
        .select('*')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const projectRows = toTypedRows(rows, isProjectRow, 'projects');
      if (projectRows.length === 0) {
        // Account has no projects yet.
        this.projects = [];
        return;
      }

      // 2. Fetch all child rows in parallel
      const projectIds = projectRows.map((row) => row.id);
      const [nodesRes, connsRes, versRes] = await Promise.all([
        supabase.from('prompt_nodes').select('*').in('project_id', projectIds).order('sort_order'),
        supabase.from('connections').select('*').in('project_id', projectIds),
        supabase.from('prompt_versions').select('*').in('project_id', projectIds).order('timestamp'),
      ]);
      this.assertNoError(nodesRes, 'fetch prompt_nodes');
      this.assertNoError(connsRes, 'fetch connections');
      this.assertNoError(versRes, 'fetch prompt_versions');

      const nodeRows = toTypedRows(nodesRes.data, isPromptNodeRow, 'prompt_nodes');
      const connectionRows = toTypedRows(connsRes.data, isConnectionRow, 'connections');
      const versionRows = toTypedRows(versRes.data, isPromptVersionRow, 'prompt_versions');
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

  /* ── localStorage fallback ────────── */

  private loadLocalStorage(): void {
    const raw = localStorage.getItem(this.storageKey());
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        this.projects = isProjectArray(parsed) ? parsed : [];
      } catch {
        this.projects = [];
      }
    } else {
      this.projects = [];
    }
  }

  private saveLocalStorage(): void {
    localStorage.setItem(this.storageKey(), JSON.stringify(this.projects));
  }

  /* ── Remote helpers ───────────────── */

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

  /* ── Read operations (sync, from cache) ── */

  getProjects(): Project[] {
    return this.projects;
  }

  getProject(id: string): Project | undefined {
    return this.projects.find(p => p.id === id);
  }

  /* ── Project mutations ────────────── */

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

  deleteProject(id: string): void {
    this.projects = this.projects.filter(p => p.id !== id);
    this.bg(async () => {
      // Cascade delete handled by DB foreign keys
      const res = await supabase.from('projects').delete().eq('id', id);
      this.assertNoError(res, 'delete project');
    });
  }

  /* ── Node operations ─────────────── */

  addNode(projectId: string, node: PromptNode): void {
    const p = this.getProject(projectId);
    if (!p) return;
    p.nodes.push(node);
    p.lastEdited = 'Just now';
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
      const projectUpdateRes = await supabase.from('projects').update({ last_edited: 'Just now' }).eq('id', projectId);
      this.assertNoError(projectUpdateRes, 'touch project last_edited');
    });
  }

  updateNode(projectId: string, nodeId: string, updates: Partial<PromptNode>): void {
    const p = this.getProject(projectId);
    if (!p) return;
    const n = p.nodes.find(n => n.id === nodeId);
    if (!n) return;
    Object.assign(n, updates);
    p.lastEdited = 'Just now';
    this.bg(async () => {
      // Map model field names to DB column names
      const dbUpdates: PromptNodeUpdate = {};
      if (updates.type !== undefined) dbUpdates.type = updates.type;
      if (updates.label !== undefined) dbUpdates.label = updates.label;
      if (updates.icon !== undefined) dbUpdates.icon = updates.icon;
      if (updates.x !== undefined) dbUpdates.x = updates.x;
      if (updates.y !== undefined) dbUpdates.y = updates.y;
      if (updates.content !== undefined) dbUpdates.content = updates.content;
      if (updates.meta !== undefined) dbUpdates.meta = updates.meta;
      if (Object.keys(dbUpdates).length > 0) {
        const nodeUpdateRes = await supabase.from('prompt_nodes').update(dbUpdates).eq('id', nodeId);
        this.assertNoError(nodeUpdateRes, 'update prompt_node');
      }
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
    this.bg(async () => {
      // Connections cascade via FK on delete
      const nodeDeleteRes = await supabase.from('prompt_nodes').delete().eq('id', nodeId);
      this.assertNoError(nodeDeleteRes, 'delete prompt_node');
      const projectUpdateRes = await supabase.from('projects').update({ last_edited: 'Just now' }).eq('id', projectId);
      this.assertNoError(projectUpdateRes, 'touch project last_edited');
    });
  }

  /* ── Connection operations ───────── */

  addConnection(projectId: string, from: string, to: string): void {
    const p = this.getProject(projectId);
    if (!p) return;
    if (p.connections.some(c => c.from === from && c.to === to)) return;
    const conn: Connection = { id: uid(), from, to };
    p.connections.push(conn);
    this.bg(async () => {
      await this.insertConnectionRemote(projectId, conn);
    });
  }

  removeConnection(projectId: string, connectionId: string): void {
    const p = this.getProject(projectId);
    if (!p) return;
    p.connections = p.connections.filter(c => c.id !== connectionId);
    this.bg(async () => {
      const connDeleteRes = await supabase.from('connections').delete().eq('id', connectionId);
      this.assertNoError(connDeleteRes, 'delete connection');
    });
  }

  /* ── Version / diff operations ───── */

  saveVersion(projectId: string, content: string, notes: string): PromptVersion {
    const p = this.getProject(projectId);
    const ver: PromptVersion = { id: uid(), timestamp: Date.now(), content, notes };
    if (p) {
      p.versions.push(ver);
      this.bg(async () => {
        const versionInsertRes = await supabase.from('prompt_versions').insert({
          id: ver.id,
          project_id: projectId,
          timestamp: ver.timestamp,
          content: ver.content,
          notes: ver.notes,
        });
        this.assertNoError(versionInsertRes, 'insert prompt_version');
      });
    }
    return ver;
  }

  getVersions(projectId: string): PromptVersion[] {
    return this.getProject(projectId)?.versions ?? [];
  }

  /* ── Assembled prompt ────────────── */

  assemblePrompt(projectId: string): string {
    const p = this.getProject(projectId);
    if (!p) return '';
    const visited = new Set<string>();
    const sorted: PromptNode[] = [];
    const adj = new Map<string, string[]>();

    for (const c of p.connections) {
      if (!adj.has(c.from)) adj.set(c.from, []);
      adj.get(c.from)!.push(c.to);
    }

    const inDegree = new Map<string, number>();
    for (const n of p.nodes) inDegree.set(n.id, 0);
    for (const c of p.connections) {
      inDegree.set(c.to, (inDegree.get(c.to) ?? 0) + 1);
    }

    const queue = p.nodes.filter(n => (inDegree.get(n.id) ?? 0) === 0);
    while (queue.length) {
      const node = queue.shift()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      sorted.push(node);
      for (const nextId of (adj.get(node.id) ?? [])) {
        const nextNode = p.nodes.find(n => n.id === nextId);
        if (nextNode && !visited.has(nextId)) queue.push(nextNode);
      }
    }
    for (const n of p.nodes) {
      if (!visited.has(n.id)) sorted.push(n);
    }

    return sorted.map(n => n.content).join('\n\n');
  }

  persist(): void {
    this.saveLocalStorage();
  }

  private async insertConnectionRemote(projectId: string, connection: Connection): Promise<void> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const connInsertRes = await supabase.from('connections').insert({
        id: connection.id,
        project_id: projectId,
        from_node_id: connection.from,
        to_node_id: connection.to,
      });

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

/* ── Row → model mappers ──────────────────────── */

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
  return {
    id: row.id,
    type: toNodeType(row.type),
    label: row.label,
    icon: row.icon,
    x: row.x,
    y: row.y,
    content: row.content,
    meta: row.meta ?? {},
  };
}

function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    from: row.from_node_id,
    to: row.to_node_id,
  };
}

function toVersion(row: PromptVersionRow): PromptVersion {
  return {
    id: row.id,
    timestamp: row.timestamp,
    content: row.content,
    notes: row.notes,
  };
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
    typeof value.created_at === 'string'
  );
}

function isProjectArray(value: unknown): value is Project[] {
  return Array.isArray(value) && value.every(isProject);
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
    isNodeType(value.type) &&
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
    typeof value.to === 'string'
  );
}

function isPromptVersion(value: unknown): value is PromptVersion {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.timestamp === 'number' &&
    typeof value.content === 'string' &&
    typeof value.notes === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'string');
}

export const store = new Store();


