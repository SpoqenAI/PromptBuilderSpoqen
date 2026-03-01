/**
 * Auto-generated Supabase Database types.
 * Matches the schema defined in supabase/migration.sql.
 */

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string;
          owner_id: string | null;
          name: string;
          description: string;
          model: string;
          icon: string;
          last_edited: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string | null;
          name: string;
          description?: string;
          model?: string;
          icon?: string;
          last_edited?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string | null;
          name?: string;
          description?: string;
          model?: string;
          icon?: string;
          last_edited?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      prompt_nodes: {
        Row: {
          id: string;
          project_id: string;
          type: string;
          label: string;
          icon: string;
          x: number;
          y: number;
          content: string;
          meta: Record<string, string>;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          type: string;
          label: string;
          icon?: string;
          x?: number;
          y?: number;
          content?: string;
          meta?: Record<string, string>;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          type?: string;
          label?: string;
          icon?: string;
          x?: number;
          y?: number;
          content?: string;
          meta?: Record<string, string>;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      connections: {
        Row: {
          id: string;
          project_id: string;
          from_node_id: string;
          to_node_id: string;
          label?: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          from_node_id: string;
          to_node_id: string;
          label?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          from_node_id?: string;
          to_node_id?: string;
          label?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      prompt_versions: {
        Row: {
          id: string;
          project_id: string;
          timestamp: number;
          content: string;
          notes: string;
          snapshot_json: {
            nodes: Array<{
              id: string;
              type: string;
              label: string;
              icon: string;
              x: number;
              y: number;
              content: string;
              meta: Record<string, string>;
            }>;
            connections: Array<{
              id: string;
              from: string;
              to: string;
              label?: string;
            }>;
          } | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          timestamp?: number;
          content?: string;
          notes?: string;
          snapshot_json?: {
            nodes: Array<{
              id: string;
              type: string;
              label: string;
              icon: string;
              x: number;
              y: number;
              content: string;
              meta: Record<string, string>;
            }>;
            connections: Array<{
              id: string;
              from: string;
              to: string;
              label?: string;
            }>;
          } | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          timestamp?: number;
          content?: string;
          notes?: string;
          snapshot_json?: {
            nodes: Array<{
              id: string;
              type: string;
              label: string;
              icon: string;
              x: number;
              y: number;
              content: string;
              meta: Record<string, string>;
            }>;
            connections: Array<{
              id: string;
              from: string;
              to: string;
              label?: string;
            }>;
          } | null;
          created_at?: string;
        };
        Relationships: [];
      };
      custom_nodes: {
        Row: {
          id: string;
          owner_id: string;
          type: string;
          label: string;
          icon: string;
          content: string;
          meta: Record<string, string>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string;
          type?: string;
          label: string;
          icon?: string;
          content?: string;
          meta?: Record<string, string>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          type?: string;
          label?: string;
          icon?: string;
          content?: string;
          meta?: Record<string, string>;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_profiles: {
        Row: {
          user_id: string;
          email: string;
          full_name: string;
          role: string;
          heard_about: string;
          primary_goal: string;
          primary_use_case: string;
          team_size: string;
          onboarding_completed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          email: string;
          full_name?: string;
          role?: string;
          heard_about?: string;
          primary_goal?: string;
          primary_use_case?: string;
          team_size?: string;
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          email?: string;
          full_name?: string;
          role?: string;
          heard_about?: string;
          primary_goal?: string;
          primary_use_case?: string;
          team_size?: string;
          onboarding_completed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      github_app_oauth_states: {
        Row: {
          state: string;
          user_id: string;
          redirect_to: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          state: string;
          user_id: string;
          redirect_to: string;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          state?: string;
          user_id?: string;
          redirect_to?: string;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      github_installations: {
        Row: {
          user_id: string;
          installation_id: number;
          account_login: string;
          account_type: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          installation_id: number;
          account_login?: string;
          account_type?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          installation_id?: number;
          account_login?: string;
          account_type?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      transcript_sets: {
        Row: {
          id: string;
          owner_id: string;
          project_id: string | null;
          name: string;
          description: string;
          source: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string;
          project_id?: string | null;
          name: string;
          description?: string;
          source?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          project_id?: string | null;
          name?: string;
          description?: string;
          source?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      transcripts: {
        Row: {
          id: string;
          transcript_set_id: string;
          external_id: string;
          title: string;
          transcript_text: string;
          metadata: Record<string, unknown>;
          ingested_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          transcript_set_id: string;
          external_id?: string;
          title?: string;
          transcript_text: string;
          metadata?: Record<string, unknown>;
          ingested_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          transcript_set_id?: string;
          external_id?: string;
          title?: string;
          transcript_text?: string;
          metadata?: Record<string, unknown>;
          ingested_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      transcript_flows: {
        Row: {
          id: string;
          transcript_id: string;
          prompt_version_id: string | null;
          model: string;
          flow_title: string;
          flow_summary: string;
          nodes_json: unknown[];
          connections_json: unknown[];
          used_fallback: boolean;
          warning: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          transcript_id: string;
          prompt_version_id?: string | null;
          model?: string;
          flow_title?: string;
          flow_summary?: string;
          nodes_json?: unknown[];
          connections_json?: unknown[];
          used_fallback?: boolean;
          warning?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          transcript_id?: string;
          prompt_version_id?: string | null;
          model?: string;
          flow_title?: string;
          flow_summary?: string;
          nodes_json?: unknown[];
          connections_json?: unknown[];
          used_fallback?: boolean;
          warning?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      canonical_flow_nodes: {
        Row: {
          id: string;
          transcript_set_id: string;
          label: string;
          type: string;
          icon: string;
          content: string;
          meta: Record<string, unknown>;
          support_count: number;
          confidence: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          transcript_set_id: string;
          label: string;
          type?: string;
          icon?: string;
          content?: string;
          meta?: Record<string, unknown>;
          support_count?: number;
          confidence?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          transcript_set_id?: string;
          label?: string;
          type?: string;
          icon?: string;
          content?: string;
          meta?: Record<string, unknown>;
          support_count?: number;
          confidence?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      canonical_flow_edges: {
        Row: {
          id: string;
          transcript_set_id: string;
          from_node_id: string;
          to_node_id: string;
          reason: string;
          support_count: number;
          transition_rate: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          transcript_set_id: string;
          from_node_id: string;
          to_node_id: string;
          reason?: string;
          support_count?: number;
          transition_rate?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          transcript_set_id?: string;
          from_node_id?: string;
          to_node_id?: string;
          reason?: string;
          support_count?: number;
          transition_rate?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      prompt_flow_alignments: {
        Row: {
          id: string;
          transcript_set_id: string;
          project_id: string;
          prompt_node_id: string;
          canonical_node_id: string;
          alignment_score: number;
          alignment_reason: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          transcript_set_id: string;
          project_id: string;
          prompt_node_id: string;
          canonical_node_id: string;
          alignment_score?: number;
          alignment_reason?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          transcript_set_id?: string;
          project_id?: string;
          prompt_node_id?: string;
          canonical_node_id?: string;
          alignment_score?: number;
          alignment_reason?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      optimization_runs: {
        Row: {
          id: string;
          transcript_set_id: string;
          project_id: string | null;
          status: string;
          objective: string;
          input_snapshot: Record<string, unknown>;
          output_patch: Record<string, unknown>;
          metrics: Record<string, unknown>;
          error_message: string;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          transcript_set_id: string;
          project_id?: string | null;
          status?: string;
          objective?: string;
          input_snapshot?: Record<string, unknown>;
          output_patch?: Record<string, unknown>;
          metrics?: Record<string, unknown>;
          error_message?: string;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          transcript_set_id?: string;
          project_id?: string | null;
          status?: string;
          objective?: string;
          input_snapshot?: Record<string, unknown>;
          output_patch?: Record<string, unknown>;
          metrics?: Record<string, unknown>;
          error_message?: string;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      optimization_run_patches: {
        Row: {
          id: string;
          optimization_run_id: string;
          project_id: string;
          prompt_node_id: string;
          old_content: string;
          new_content: string;
          rationale: string;
          evidence: unknown[];
          confidence: number;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          optimization_run_id: string;
          project_id: string;
          prompt_node_id: string;
          old_content?: string;
          new_content?: string;
          rationale?: string;
          evidence?: unknown[];
          confidence?: number;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          optimization_run_id?: string;
          project_id?: string;
          prompt_node_id?: string;
          old_content?: string;
          new_content?: string;
          rationale?: string;
          evidence?: unknown[];
          confidence?: number;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      prompt_node_sync_meta: {
        Row: {
          prompt_node_id: string;
          section_hash: string;
          last_assembled_at: string;
          updated_at: string;
        };
        Insert: {
          prompt_node_id: string;
          section_hash: string;
          last_assembled_at?: string;
          updated_at?: string;
        };
        Update: {
          prompt_node_id?: string;
          section_hash?: string;
          last_assembled_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      delete_current_user: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
  };
}
