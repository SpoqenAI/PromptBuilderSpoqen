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
        Relationships: [];
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
