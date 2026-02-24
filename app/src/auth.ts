import type { User } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { supabase } from './supabase';
import { store } from './store';

type UserProfileRow = Database['public']['Tables']['user_profiles']['Row'];
type UserProfileInsert = Database['public']['Tables']['user_profiles']['Insert'];

export interface OnboardingInput {
  fullName: string;
  role: string;
  heardAbout: string;
  primaryGoal: string;
  primaryUseCase: string;
  teamSize: string;
}

export interface AccountProfileInput {
  fullName: string;
  role: string;
  heardAbout: string;
  primaryGoal: string;
  primaryUseCase: string;
  teamSize: string;
}

export interface SignUpResult {
  duplicateAccount: boolean;
  emailVerificationRequired: boolean;
}

export async function getCurrentUser(): Promise<User | null> {
  const sessionRes = await supabase.auth.getSession();
  if (sessionRes.error) {
    throw new Error(`auth session error: ${sessionRes.error.message}`);
  }
  return sessionRes.data.session?.user ?? null;
}

export async function signInWithPassword(
  email: string,
  password: string,
  captchaToken?: string,
): Promise<void> {
  const signInOptions = captchaToken ? { captchaToken } : undefined;
  const signInRes = await supabase.auth.signInWithPassword({
    email,
    password,
    options: signInOptions,
  });
  if (signInRes.error) {
    throw new Error(signInRes.error.message);
  }
  store.reset();
}

export async function signUpWithPassword(
  email: string,
  password: string,
  fullName: string,
  captchaToken?: string,
): Promise<SignUpResult> {
  const signUpOptions = {
    emailRedirectTo: `${window.location.origin}${window.location.pathname}#/auth/sign-in`,
    data: {
      full_name: fullName,
    },
    ...(captchaToken ? { captchaToken } : {}),
  };

  const signUpRes = await supabase.auth.signUp({
    email,
    password,
    options: signUpOptions,
  });

  if (signUpRes.error) {
    const message = signUpRes.error.message.toLowerCase();
    const duplicate = message.includes('already registered') || message.includes('already exists');
    if (duplicate) {
      return {
        duplicateAccount: true,
        emailVerificationRequired: true,
      };
    }
    throw new Error(signUpRes.error.message);
  }

  const duplicateAccount = (signUpRes.data.user?.identities?.length ?? 0) === 0;
  const emailVerificationRequired = !signUpRes.data.session;
  if (signUpRes.data.session) {
    store.reset();
  }

  return {
    duplicateAccount,
    emailVerificationRequired,
  };
}

export async function signOut(): Promise<void> {
  const signOutRes = await supabase.auth.signOut();
  if (signOutRes.error) {
    throw new Error(signOutRes.error.message);
  }
  store.reset();
}

export async function getOnboardingProfile(userId: string): Promise<UserProfileRow | null> {
  const profileRes = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileRes.error) {
    throw new Error(`load profile failed: ${profileRes.error.message}`);
  }

  if (!profileRes.data) return null;
  if (!isUserProfileRow(profileRes.data)) {
    throw new Error('load profile failed: invalid user_profiles row shape');
  }
  return profileRes.data;
}

export async function isOnboardingComplete(userId: string): Promise<boolean> {
  const profile = await getOnboardingProfile(userId);
  return Boolean(profile?.onboarding_completed);
}

export async function saveOnboardingProfile(
  user: User,
  input: OnboardingInput,
): Promise<void> {
  const payload: UserProfileInsert = {
    user_id: user.id,
    email: user.email ?? '',
    full_name: input.fullName.trim(),
    role: input.role.trim(),
    heard_about: input.heardAbout.trim(),
    primary_goal: input.primaryGoal.trim(),
    primary_use_case: input.primaryUseCase.trim(),
    team_size: input.teamSize.trim(),
    onboarding_completed: true,
    updated_at: new Date().toISOString(),
  };

  const saveRes = await supabase
    .from('user_profiles')
    .upsert(payload, { onConflict: 'user_id' });

  if (saveRes.error) {
    throw new Error(`save onboarding failed: ${saveRes.error.message}`);
  }
}

export async function updateCurrentUserProfile(input: AccountProfileInput): Promise<UserProfileRow> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('update profile failed: no active user session');
  }

  const payload: UserProfileInsert = {
    user_id: user.id,
    email: user.email ?? '',
    full_name: input.fullName.trim(),
    role: input.role.trim(),
    heard_about: input.heardAbout.trim(),
    primary_goal: input.primaryGoal.trim(),
    primary_use_case: input.primaryUseCase.trim(),
    team_size: input.teamSize.trim(),
    onboarding_completed: true,
    updated_at: new Date().toISOString(),
  };

  const profileRes = await supabase
    .from('user_profiles')
    .upsert(payload, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (profileRes.error) {
    throw new Error(`update profile failed: ${profileRes.error.message}`);
  }

  if (!isUserProfileRow(profileRes.data)) {
    throw new Error('update profile failed: invalid user_profiles row shape');
  }

  const metadataRes = await supabase.auth.updateUser({
    data: { full_name: payload.full_name },
  });
  if (metadataRes.error) {
    throw new Error(`update profile metadata failed: ${metadataRes.error.message}`);
  }

  return profileRes.data;
}

export async function updateCurrentUserPassword(newPassword: string): Promise<void> {
  const password = newPassword.trim();
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }

  const updateRes = await supabase.auth.updateUser({ password });
  if (updateRes.error) {
    throw new Error(`password update failed: ${updateRes.error.message}`);
  }
}

export async function sendPasswordResetEmail(email: string): Promise<void> {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) {
    throw new Error('Password reset failed: missing account email.');
  }

  const resetRes = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
    redirectTo: `${window.location.origin}${window.location.pathname}#/auth/sign-in`,
  });
  if (resetRes.error) {
    throw new Error(`password reset failed: ${resetRes.error.message}`);
  }
}

export async function deleteCurrentUserAccount(): Promise<void> {
  const deleteRes = await supabase.rpc('delete_current_user');
  if (deleteRes.error) {
    throw new Error(`delete account failed: ${deleteRes.error.message}`);
  }
  if (!deleteRes.data) {
    throw new Error('delete account failed: user record was not removed.');
  }

  store.reset();
}

function isUserProfileRow(value: unknown): value is UserProfileRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.user_id === 'string' &&
    typeof row.email === 'string' &&
    typeof row.full_name === 'string' &&
    typeof row.role === 'string' &&
    typeof row.heard_about === 'string' &&
    typeof row.primary_goal === 'string' &&
    typeof row.primary_use_case === 'string' &&
    typeof row.team_size === 'string' &&
    typeof row.onboarding_completed === 'boolean' &&
    typeof row.created_at === 'string' &&
    typeof row.updated_at === 'string'
  );
}
