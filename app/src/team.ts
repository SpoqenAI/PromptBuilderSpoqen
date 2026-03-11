import { supabase } from './supabase';

export interface PlanMember {
  id: string;
  memberUserId: string;
  email: string;
  fullName: string;
  creditsRemaining: number | null;
  creditsAllowance: number | null;
}

export interface PlanOwnerInfo {
  ownerUserId: string;
  fullName: string;
  email: string;
}

export async function getPlanMembers(): Promise<PlanMember[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: members, error } = await supabase
    .from('plan_members')
    .select('id, member_user_id')
    .eq('owner_id', user.id);

  if (error || !members || members.length === 0) return [];

  const memberUserIds = members.map((m) => m.member_user_id);

  const [profilesRes, creditsRes] = await Promise.all([
    supabase.from('user_profiles').select('user_id, email, full_name').in('user_id', memberUserIds),
    supabase.from('user_credits').select('user_id, credits_remaining, credits_allowance').in('user_id', memberUserIds),
  ]);

  const profileMap = new Map<string, { email: string; fullName: string }>();
  for (const row of (profilesRes.data ?? [])) {
    profileMap.set(row.user_id, { email: row.email, fullName: row.full_name });
  }

  const creditsMap = new Map<string, { remaining: number; allowance: number }>();
  for (const row of (creditsRes.data ?? [])) {
    creditsMap.set(row.user_id, { remaining: row.credits_remaining, allowance: row.credits_allowance });
  }

  return members.map((m) => {
    const profile = profileMap.get(m.member_user_id);
    const creds = creditsMap.get(m.member_user_id);
    return {
      id: m.id,
      memberUserId: m.member_user_id,
      email: profile?.email ?? 'Unknown',
      fullName: profile?.fullName ?? '',
      creditsRemaining: creds?.remaining ?? null,
      creditsAllowance: creds?.allowance ?? null,
    };
  });
}

export async function addPlanMember(email: string): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not signed in.' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('user_id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle();

  if (!profile) return { success: false, error: 'No user found with that email address.' };
  if (profile.user_id === user.id) return { success: false, error: 'You cannot add yourself to your own plan.' };

  const { error } = await supabase.from('plan_members').insert({
    owner_id: user.id,
    member_user_id: profile.user_id,
  });

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      return { success: false, error: 'This user is already on your plan.' };
    }
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function removePlanMember(membershipId: string): Promise<void> {
  await supabase.from('plan_members').delete().eq('id', membershipId);
}

export async function addCreditsToMember(memberUserId: string, amount: number): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not signed in.' };

  const { data: membership } = await supabase
    .from('plan_members')
    .select('id')
    .eq('owner_id', user.id)
    .eq('member_user_id', memberUserId)
    .maybeSingle();

  if (!membership) return { success: false, error: 'User is not on your plan.' };

  const { data: current } = await supabase
    .from('user_credits')
    .select('credits_remaining')
    .eq('user_id', memberUserId)
    .maybeSingle();

  const newRemaining = (current?.credits_remaining ?? 0) + amount;

  const { error } = await supabase
    .from('user_credits')
    .upsert({
      user_id: memberUserId,
      credits_remaining: newRemaining,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function getPlanOwner(): Promise<PlanOwnerInfo | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from('plan_members')
    .select('owner_id')
    .eq('member_user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) return null;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('user_id, email, full_name')
    .eq('user_id', membership.owner_id)
    .maybeSingle();

  if (!profile) return null;

  return {
    ownerUserId: profile.user_id,
    fullName: profile.full_name,
    email: profile.email,
  };
}

export async function isCurrentUserPlanOwner(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { count } = await supabase
    .from('plan_members')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id);

  return (count ?? 0) > 0;
}
