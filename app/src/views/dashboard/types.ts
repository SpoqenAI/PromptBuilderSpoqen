export type DashboardLayout = 'grid' | 'list';
export const DASHBOARD_LAYOUT_KEY = 'promptblueprint_dashboard_layout';
export const FOLDER_SIDEBAR_KEY = 'promptblueprint_folder_sidebar';
export const FOLDER_EXPANDED_KEY = 'promptblueprint_folder_expanded';

export interface DashboardAccountState {
  avatarUrl: string | null;
  displayName: string;
  initials: string;
  email: string;
  fullName: string;
  planLabel: string;
  planDetail: string;
}

export type MessageKind = 'success' | 'error';
