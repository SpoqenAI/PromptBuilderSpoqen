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
          name: string;
          description: string;
          model: string;
          icon: string;
          last_edited: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string;
          model?: string;
          icon?: string;
          last_edited?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string;
          model?: string;
          icon?: string;
          last_edited?: string;
          created_at?: string;
        };
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
      };
      connections: {
        Row: {
          id: string;
          project_id: string;
          from_node_id: string;
          to_node_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          from_node_id: string;
          to_node_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          from_node_id?: string;
          to_node_id?: string;
          created_at?: string;
        };
      };
      prompt_versions: {
        Row: {
          id: string;
          project_id: string;
          timestamp: number;
          content: string;
          notes: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          timestamp?: number;
          content?: string;
          notes?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          timestamp?: number;
          content?: string;
          notes?: string;
          created_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
