/**
 * Store — Manages application state backed by Supabase.
 *
 * Strategy: load-on-init into memory; sync reads, async writes.
 * All mutating calls update the in-memory cache immediately (keeping
 * the UI synchronous) and fire a background Supabase call.
 */
import { Project, PromptNode, Connection, PromptVersion, uid } from './models';
import { supabase } from './supabase';

/* ── Seed data ────────────────────────────────── */
function seedProjects(): Project[] {
  return [
    {
      id: uid(), name: 'Customer Support Workflow',
      description: 'Automated ticket classification and sentiment analysis using multi-stage reasoning nodes.',
      model: 'GPT-4o', icon: 'schema', lastEdited: '2h ago',
      nodes: [], connections: [], versions: [],
    },
    {
      id: uid(), name: 'Creative Story Generator',
      description: 'A recursive narrative engine designed to maintain consistency across character arcs.',
      model: 'Claude 3.5', icon: 'auto_awesome', lastEdited: '5h ago',
      nodes: [], connections: [], versions: [],
    },
    {
      id: uid(), name: 'SQL Query Optimizer',
      description: 'Refines slow legacy SQL queries by suggesting modern indexing strategies.',
      model: 'GPT-4 Turbo', icon: 'code', lastEdited: 'Yesterday',
      nodes: [], connections: [], versions: [],
    },
    {
      id: uid(), name: 'Market Analysis RAG',
      description: 'A retrieval augmented generation pipeline for real-time financial news parsing.',
      model: 'Llama 3', icon: 'hub', lastEdited: '3 days ago',
      nodes: [], connections: [], versions: [],
    },
  ];
}

class Store {
  private projects: Project[] = [];
  private _ready: Promise<void>;

  constructor() {
    this._ready = this.init();
  }

  /** Resolves when all Supabase data is loaded into memory. */
  get ready(): Promise<void> {
    return this._ready;
  }

  /* ── Initialisation ───────────────── */

  private async init(): Promise<void> {
    try {
      await this.ensureSession();

      // 1. Fetch projects
      const { data: rows, error } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (!rows || rows.length === 0) {
        // Seed if empty
        const seeds = seedProjects();
        for (const p of seeds) {
          await this.insertProjectRemote(p);
        }
        this.projects = seeds;
        return;
      }

      // 2. Fetch all child rows in parallel
      const projectIds = rows.map(r => r.id);
      const [nodesRes, connsRes, versRes] = await Promise.all([
        supabase.from('prompt_nodes').select('*').in('project_id', projectIds).order('sort_order'),
        supabase.from('connections').select('*').in('project_id', projectIds),
        supabase.from('prompt_versions').select('*').in('project_id', projectIds).order('timestamp'),
      ]);
      this.assertNoError(nodesRes, 'fetch prompt_nodes');
      this.assertNoError(connsRes, 'fetch connections');
      this.assertNoError(versRes, 'fetch prompt_versions');

      const nodesByProject = groupBy(nodesRes.data ?? [], 'project_id');
      const connsByProject = groupBy(connsRes.data ?? [], 'project_id');
      const versByProject  = groupBy(versRes.data ?? [], 'project_id');

      this.projects = rows.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        model: r.model,
        icon: r.icon,
        lastEdited: r.last_edited,
        nodes: (nodesByProject[r.id] ?? []).map(toPromptNode),
        connections: (connsByProject[r.id] ?? []).map(toConnection),
        versions: (versByProject[r.id] ?? []).map(toVersion),
      }));
    } catch (err) {
      console.error('Supabase init failed, falling back to localStorage:', err);
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
    const raw = localStorage.getItem('promptblueprint_projects');
    if (raw) {
      try { this.projects = JSON.parse(raw); } catch { this.projects = seedProjects(); }
    } else {
      this.projects = seedProjects();
    }
  }

  private saveLocalStorage(): void {
    localStorage.setItem('promptblueprint_projects', JSON.stringify(this.projects));
  }

  /* ── Remote helpers ───────────────── */

  private async ensureSession(): Promise<void> {
    const sessionRes = await supabase.auth.getSession();
    this.assertNoError(sessionRes, 'read auth session');

    if (sessionRes.data.session) return;

    const anonSignInRes = await supabase.auth.signInAnonymously();
    this.assertNoError(
      anonSignInRes,
      'anonymous sign-in failed (enable Anonymous provider in Supabase Auth if this is disabled)'
    );
  }

  private assertNoError(result: { error: { message: string } | null }, context: string): void {
    if (result.error) {
      throw new Error(`${context}: ${result.error.message}`);
    }
  }

  private isSchemaMismatch(err: unknown): boolean {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message?: unknown }).message ?? '')
          : String(err ?? '');
    return message.includes('schema cache') || message.includes("Could not find the '");
  }

  private async insertProjectRemote(p: Project): Promise<void> {
    const res = await supabase.from('projects').insert({
      id: p.id,
      name: p.name,
      description: p.description,
      model: p.model,
      icon: p.icon,
      last_edited: p.lastEdited,
    });
    this.assertNoError(res, 'insert project');
  }

  private bg(fn: () => Promise<void>): void {
    fn().catch(err => console.error('Supabase bg error:', err));
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
    this.bg(async () => { await this.insertProjectRemote(project); });
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
      const dbUpdates: Record<string, unknown> = {};
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
      const connInsertRes = await supabase.from('connections').insert({
        id: conn.id,
        project_id: projectId,
        from_node_id: from,
        to_node_id: to,
      });
      this.assertNoError(connInsertRes, 'insert connection');
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
}

/* ── Row → model mappers ──────────────────────── */

function toPromptNode(row: Record<string, unknown>): PromptNode {
  return {
    id: row.id as string,
    type: row.type as PromptNode['type'],
    label: row.label as string,
    icon: row.icon as string,
    x: row.x as number,
    y: row.y as number,
    content: row.content as string,
    meta: (row.meta ?? {}) as Record<string, string>,
  };
}

function toConnection(row: Record<string, unknown>): Connection {
  return {
    id: row.id as string,
    from: row.from_node_id as string,
    to: row.to_node_id as string,
  };
}

function toVersion(row: Record<string, unknown>): PromptVersion {
  return {
    id: row.id as string,
    timestamp: row.timestamp as number,
    content: row.content as string,
    notes: row.notes as string,
  };
}

function groupBy<T extends Record<string, unknown>>(items: T[], key: string): Record<string, T[]> {
  const map: Record<string, T[]> = {};
  for (const item of items) {
    const k = item[key] as string;
    if (!map[k]) map[k] = [];
    map[k].push(item);
  }
  return map;
}

export const store = new Store();
