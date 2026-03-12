import { router } from '../router';
import { themeToggleHTML, wireThemeToggle } from '../theme';
import {
  getSubscription,
  createCheckoutSessionByTier,
  createPortalSession,
  tierLabel,
  statusLabel,
  statusColor,
  formatPeriodEnd,
  type Subscription,
  type SubscriptionTier,
} from '../billing';
import { getSubscriptionLimits, type SubscriptionLimits } from '../subscription-limits';
import { getUserCredits, type UserCredits } from '../credits';
import {
  getPlanMembers,
  getPlanOwner,
  addPlanMember,
  removePlanMember,
  addCreditsToMember,
  type PlanMember,
  type PlanOwnerInfo,
} from '../team';
import {
  getOrgBillingSummary,
  formatLockDate,
  getSeatUnitPrice,
  type OrgBillingSummary,
} from '../org-billing';

export function renderBilling(container: HTMLElement): void {
  let subscription: Subscription | null = null;
  let limits: SubscriptionLimits | null = null;
  let credits: UserCredits | null = null;
  let planMembers: PlanMember[] = [];
  let planOwner: PlanOwnerInfo | null = null;
  let orgSummary: OrgBillingSummary | null = null;
  let loading = true;
  let actionLoading = false;
  let errorMessage = '';
  let successMessage = '';

  const hash = window.location.hash;
  if (hash.includes('success=1')) {
    successMessage = 'Subscription activated! Welcome aboard.';
  } else if (hash.includes('canceled=1')) {
    errorMessage = 'Checkout was canceled. No charges were made.';
  }

  function getHeaderSubtitle(): string {
    if (limits?.hasFullAccess) return 'Team / Beta access';
    if (subscription) return 'Manage your subscription';
    return 'Upgrade to unlock full access';
  }

  function getStatusBanner(): string {
    if (successMessage || errorMessage) return '';
    if (limits?.hasFullAccess) {
      return 'You have full access via team/beta. Stripe billing is disabled for your account.';
    }
    if (subscription) {
      return 'Your subscription is managed by Stripe. Use Manage Subscription to update payment details or cancel.';
    }
    return 'You\'re on the Free plan with 25 credits/month. Upgrade anytime to unlock more credits and features.';
  }

  function render(): void {
    const subtitle = getHeaderSubtitle();
    const statusBanner = getStatusBanner();

    container.innerHTML = `
      <header class="ui-header z-20">
        <div class="ui-header-left">
          <button type="button" class="w-8 h-8 flex items-center justify-center cursor-pointer rounded" id="nav-home" aria-label="Go to dashboard">
            <img src="${import.meta.env.BASE_URL}Icon.svg" alt="Spoqen" class="w-8 h-8 object-contain" />
          </button>
          <div class="min-w-0">
            <h1 class="text-sm font-semibold leading-none">Billing</h1>
            <span class="text-[10px] text-slate-400 uppercase tracking-wider">${subtitle}</span>
          </div>
        </div>
        <div class="ui-header-center"></div>
        <div class="ui-header-right ui-toolbar">
          ${themeToggleHTML()}
        </div>
      </header>

      <main class="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          ${successMessage ? `<div class="mb-6 rounded-lg border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950 px-4 py-3 text-sm text-green-800 dark:text-green-200">${successMessage}</div>` : ''}
          ${errorMessage ? `<div class="mb-6 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">${errorMessage}</div>` : ''}
          ${statusBanner && !successMessage && !errorMessage ? `<div class="mb-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-sm text-slate-700 dark:text-slate-300">${statusBanner}</div>` : ''}
          ${loading ? renderLoading() : renderContent()}
          ${!loading ? renderFaqFooter() : ''}
        </div>
      </main>
    `;

    wireThemeToggle(container);
    container.querySelector('#nav-home')?.addEventListener('click', () => router.navigate('/'));
    wireActions();
  }

  function renderLoading(): string {
    return `
      <div class="flex flex-col items-center justify-center gap-4 py-20">
        <div class="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
        <p class="text-sm text-slate-500 font-medium">Loading subscription...</p>
      </div>
    `;
  }

  function renderContent(): string {
    if (limits?.hasFullAccess) {
      return renderTeamBetaCard();
    }
    if (subscription) {
      return renderCurrentPlan(subscription) + renderOrgSeatsSummary() + renderCreditTracker() + renderTeamSection();
    }
    return renderPricingCards() + renderCreditTracker() + renderPlanOwnerBanner();
  }

  function renderCreditTracker(): string {
    if (!credits) return '';
    const pct = credits.creditsAllowance > 0
      ? Math.round((credits.creditsRemaining / credits.creditsAllowance) * 100)
      : 0;
    const barColor = pct > 25 ? 'bg-primary' : pct > 10 ? 'bg-amber-500' : 'bg-red-500';
    const periodNote = credits.periodEnd
      ? `Resets ${formatPeriodEnd(credits.periodEnd)}`
      : 'Resets at the start of your next billing cycle';

    return `
      <div class="rounded-xl border border-card-border dark:border-primary/20 bg-white dark:bg-slate-900 p-6 shadow-sm mt-8">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200">Credit Usage</h3>
          <span class="text-xs text-slate-500 dark:text-slate-400">${periodNote}</span>
        </div>
        <div class="flex items-end justify-between mb-2">
          <p class="text-2xl font-bold text-slate-900 dark:text-slate-100">${credits.creditsRemaining}<span class="text-sm font-normal text-slate-400"> / ${credits.creditsAllowance}</span></p>
          <span class="text-xs text-slate-500 dark:text-slate-400">${pct}% remaining</span>
        </div>
        <div class="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div class="${barColor} h-full rounded-full transition-all" style="width: ${pct}%"></div>
        </div>
        <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-3">Credits are consumed by prompt operations. ${subscription ? 'Purchase additional credit packs via Manage Subscription.' : 'Upgrade to a paid plan for more credits.'}</p>
      </div>
    `;
  }

  function renderTeamBetaCard(): string {
    return `
      <div class="rounded-xl border border-primary/30 bg-primary/5 dark:bg-primary/10 p-6 shadow-sm mb-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Team/Beta Access</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-green-600 dark:text-green-400 bg-green-500/10">
            <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
            Full Access
          </span>
        </div>
        <p class="text-sm text-slate-700 dark:text-slate-300 mb-4">Your organization has full access; Stripe billing is not required for this account.</p>
        <p class="text-xs text-slate-500 dark:text-slate-400">Billing managed by team</p>
      </div>
      <p class="text-sm text-slate-500 dark:text-slate-400">Billing is managed by your team; contact support if you need a change.</p>
    `;
  }

  function renderCurrentPlan(sub: Subscription): string {
    const renewalNote = sub.cancelAtPeriodEnd
      ? `<span class="text-amber-600 dark:text-amber-400">Cancels ${formatPeriodEnd(sub.currentPeriodEnd)}</span>`
      : `Renews ${formatPeriodEnd(sub.currentPeriodEnd)}`;

    const featureList = [
      'Unlimited prompt flows',
      'Unlimited transcript flows',
      'Unlimited imports',
    ];

    return `
      <div class="rounded-xl border border-card-border dark:border-primary/20 bg-white dark:bg-slate-900 p-6 shadow-sm mb-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Current Plan</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${statusColor(sub.status)} bg-current/10">
            <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
            ${statusLabel(sub.status)}
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <p class="text-xs text-slate-500 dark:text-slate-400 mb-1">Plan</p>
            <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">${tierLabel(sub.tier)}</p>
          </div>
          <div>
            <p class="text-xs text-slate-500 dark:text-slate-400 mb-1">Billing period</p>
            <p class="text-sm text-slate-700 dark:text-slate-300">${renewalNote}</p>
          </div>
        </div>

        <ul class="space-y-1.5 mb-6">
          ${featureList.map(f => `
            <li class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <span class="material-icons-outlined text-primary text-base">check_circle</span>
              ${f}
            </li>
          `).join('')}
        </ul>

        <div class="flex flex-wrap gap-3">
          <button id="btn-manage-subscription" type="button" class="rounded-lg bg-primary text-white px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50" ${actionLoading ? 'disabled' : ''}>
            ${actionLoading ? 'Loading...' : 'Manage Subscription'}
          </button>
          ${sub.tier !== 'enterprise' ? `
            <button id="btn-upgrade-enterprise" type="button" class="rounded-lg border border-primary text-primary px-4 py-2 text-sm font-medium hover:bg-primary/5 transition-colors disabled:opacity-50" ${actionLoading ? 'disabled' : ''}>
              Upgrade to Enterprise
            </button>
          ` : ''}
        </div>
      </div>
      ${subscription ? `
        <div class="rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-900 p-4 mb-8">
          <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">Looking to change plans?</h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 mb-3">Upgrade, downgrade, or cancel your subscription in the Stripe Customer Portal.</p>
          <button id="btn-change-plan" type="button" class="rounded-lg border border-primary text-primary px-3 py-2 text-sm font-medium hover:bg-primary/5 transition-colors disabled:opacity-50" ${actionLoading ? 'disabled' : ''}>
            ${actionLoading ? 'Loading...' : 'Manage plan in Stripe'}
          </button>
        </div>
      ` : ''}
    `;
  }

  function renderPricingCards(): string {
    const freeFeatures = [
      '3 prompt flows',
      '3 transcript flows',
      '3 transcript sets',
      '1 import each (prompt & transcript)',
    ];
    const individualFeatures = [
      'Unlimited prompt flows',
      'Unlimited transcript flows & imports',
      'Transcript import & flow mapping',
      'Version history & diff',
    ];
    const growthFeatures = [
      'Everything in Individual',
      'Team collaboration (up to 5 seats)',
      'Shared prompt libraries',
      'Priority support',
      'Advanced analytics',
    ];
    const enterpriseFeatures = [
      'Everything in Growth',
      'Prompt optimization runs',
      'Dedicated support & SLA',
      'SSO & advanced security (coming soon)',
    ];

    const isOnFree = !subscription && !limits?.hasFullAccess;
    const fullAccess = limits?.hasFullAccess ?? false;

    return `
      <div class="text-center mb-8">
        <h2 class="text-2xl font-bold text-slate-900 dark:text-slate-100">Choose your plan</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-2">
          Seat-based billing with monthly credits per seat. Need more? Purchase additional credit packs anytime.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        ${renderPricingCard({
          tier: null,
          title: 'Free',
          description: 'Get started with core features.',
          credits: '25 credits / month (1 seat)',
          features: freeFeatures,
          cta: isOnFree ? 'Current plan' : 'Free forever',
          highlight: false,
          disabled: true,
        })}
        ${renderPricingCard({
          tier: 'individual',
          title: 'Individual',
          description: 'For solo builders and prompt engineers.',
          credits: 'From $20/seat · 100 credits/seat/mo',
          features: individualFeatures,
          cta: 'Get Started',
          highlight: false,
          disabled: fullAccess,
        })}
        ${renderPricingCard({
          tier: 'growth',
          title: 'Growth',
          description: 'For startups with a team of 3\u20135.',
          credits: 'Graduated pricing · 500 credits/seat/mo',
          features: growthFeatures,
          cta: 'Get Started',
          highlight: true,
          disabled: fullAccess,
        })}
        ${renderPricingCard({
          tier: 'enterprise',
          title: 'Enterprise',
          description: 'For teams building production voice AI.',
          credits: 'Custom seat-based pricing & credits',
          features: enterpriseFeatures,
          cta: 'Get Started',
          highlight: false,
          disabled: fullAccess,
        })}
      </div>
    `;
  }

  function renderPricingCard(card: {
    tier: SubscriptionTier | null;
    title: string;
    description: string;
    credits: string;
    features: string[];
    cta: string;
    highlight: boolean;
    disabled?: boolean;
  }): string {
    const borderClass = card.highlight
      ? 'border-primary ring-1 ring-primary/20'
      : 'border-card-border dark:border-primary/20';
    const badge = card.highlight
      ? '<span class="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary text-white text-[10px] font-bold px-3 py-1 uppercase tracking-wider">Most popular</span>'
      : '';

    const isFree = card.tier === null;
    const btnDisabled = card.disabled || actionLoading;
    let btnContent: string;
    if (limits?.hasFullAccess && !isFree) {
      btnContent = 'Full access (team/beta)';
    } else {
      btnContent = card.cta;
    }

    return `
      <div class="relative rounded-xl border ${borderClass} bg-white dark:bg-slate-900 p-6 shadow-sm flex flex-col">
        ${badge}
        <h3 class="text-lg font-bold text-slate-900 dark:text-slate-100">${card.title}</h3>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${card.description}</p>
        <p class="text-sm font-semibold text-primary mt-2 mb-4">${card.credits}</p>

        <ul class="space-y-2 mb-4 flex-1">
          ${card.features.map(f => `
            <li class="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <span class="material-icons-outlined text-primary text-base mt-0.5">check_circle</span>
              ${f}
            </li>
          `).join('')}
        </ul>

        <p class="text-[11px] text-slate-400 dark:text-slate-500 mb-3">${isFree ? 'Need more? Subscribe to buy credit packs.' : 'Run out? Purchase additional credit packs anytime.'}</p>

        <button ${isFree ? '' : `data-tier="${card.tier}"`} type="button" class="${isFree ? '' : 'btn-subscribe '}w-full rounded-lg ${card.highlight ? 'bg-primary text-white hover:bg-primary/90' : 'border border-primary text-primary hover:bg-primary/5'} px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed" ${btnDisabled ? 'disabled' : ''} title="${card.disabled && !isFree ? 'Billing is handled by your team; your account already has full access.' : ''}">
          ${actionLoading && !card.disabled ? 'Loading...' : btnContent}
        </button>
      </div>
    `;
  }

  function renderPlanOwnerBanner(): string {
    if (!planOwner) return '';
    const ownerDisplay = planOwner.fullName || planOwner.email;
    return `
      <div class="rounded-xl border border-card-border dark:border-primary/20 bg-white dark:bg-slate-900 p-5 shadow-sm mt-8">
        <div class="flex items-center gap-3">
          <span class="material-icons-outlined text-primary text-xl">group</span>
          <div>
            <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">Your plan is managed by ${escapeAttr(ownerDisplay)}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Contact your plan administrator for changes to your subscription or to request additional credits.</p>
          </div>
        </div>
      </div>
    `;
  }

  function renderTeamSection(): string {
    const isTeamTier = subscription && (subscription.tier === 'growth' || subscription.tier === 'enterprise');
    if (!isTeamTier) {
      return renderPlanOwnerBanner();
    }

    if (planMembers.length === 0 && !planOwner) {
      return `
        <div class="rounded-xl border border-card-border dark:border-primary/20 bg-white dark:bg-slate-900 p-6 shadow-sm mt-8">
          <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Team Members</h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 mb-4">Add team members to share your plan. They'll get their own credit allowance that you can manage.</p>
          <div class="flex gap-2">
            <input id="add-member-email" type="email" placeholder="Enter email address" class="flex-1 rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none" />
            <button id="btn-add-member" type="button" class="rounded-lg bg-primary text-white px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors">Add</button>
          </div>
          <p id="add-member-error" class="text-xs text-red-500 mt-2 hidden"></p>
        </div>
      `;
    }

    if (planOwner && planMembers.length === 0) {
      return renderPlanOwnerBanner();
    }

    const memberRows = planMembers.map(m => `
      <tr class="border-t border-card-border dark:border-primary/10">
        <td class="py-3 pr-3">
          <p class="text-sm font-medium text-slate-800 dark:text-slate-200">${escapeAttr(m.fullName || m.email)}</p>
          ${m.fullName ? `<p class="text-[11px] text-slate-400">${escapeAttr(m.email)}</p>` : ''}
        </td>
        <td class="py-3 px-3 text-sm text-slate-600 dark:text-slate-300">
          ${m.creditsRemaining !== null ? `${m.creditsRemaining} / ${m.creditsAllowance ?? '—'}` : 'No data'}
        </td>
        <td class="py-3 pl-3 text-right">
          <div class="flex items-center justify-end gap-2">
            <button class="btn-add-credits-member text-xs text-primary hover:text-primary/80 font-medium" data-member-user-id="${escapeAttr(m.memberUserId)}">Add credits</button>
            <button class="btn-remove-member text-xs text-red-500 hover:text-red-600 font-medium disabled:opacity-40 disabled:cursor-not-allowed" data-membership-id="${escapeAttr(m.id)}" ${orgSummary?.isLocked ? 'disabled title="Seat removal is locked for this billing period."' : ''}>Remove</button>
          </div>
        </td>
      </tr>
    `).join('');

    return `
      <div class="rounded-xl border border-card-border dark:border-primary/20 bg-white dark:bg-slate-900 p-6 shadow-sm mt-8">
        <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-4">Team Members</h3>
        <table class="w-full text-left">
          <thead>
            <tr class="text-[11px] text-slate-400 uppercase tracking-wider">
              <th class="pb-2 pr-3 font-medium">Member</th>
              <th class="pb-2 px-3 font-medium">Credits</th>
              <th class="pb-2 pl-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${memberRows}
          </tbody>
        </table>
        <div class="mt-4 pt-4 border-t border-card-border dark:border-primary/10">
          <p class="text-xs text-slate-500 dark:text-slate-400 mb-3">Add a new team member by email</p>
          <div class="flex gap-2">
            <input id="add-member-email" type="email" placeholder="Enter email address" class="flex-1 rounded-lg border border-card-border dark:border-primary/20 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none" />
            <button id="btn-add-member" type="button" class="rounded-lg bg-primary text-white px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors">Add</button>
          </div>
          <p id="add-member-error" class="text-xs text-red-500 mt-2 hidden"></p>
        </div>
      </div>
    `;
  }

  function renderOrgSeatsSummary(): string {
    if (!orgSummary) return '';
    const unitPrice = getSeatUnitPrice(orgSummary.totalSeats);
    const lockLabel = orgSummary.lockDate ? formatLockDate(orgSummary.lockDate) : 'N/A';
    const lockStatus = orgSummary.isLocked
      ? '<span class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs font-semibold"><span class="material-icons-outlined text-sm">lock</span>Locked</span>'
      : '<span class="inline-flex items-center gap-1 text-green-600 dark:text-green-400 text-xs font-semibold"><span class="material-icons-outlined text-sm">lock_open</span>Open</span>';

    return `
      <div class="rounded-xl border border-card-border dark:border-primary/20 bg-white dark:bg-slate-900 p-6 shadow-sm mt-8">
        <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-4">Organization Seats</h3>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <div>
            <p class="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Total Seats</p>
            <p class="text-lg font-bold text-slate-900 dark:text-slate-100">${orgSummary.totalSeats}</p>
          </div>
          <div>
            <p class="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Active Members</p>
            <p class="text-lg font-bold text-slate-900 dark:text-slate-100">${orgSummary.activeMembers}</p>
          </div>
          <div>
            <p class="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Open Slots</p>
            <p class="text-lg font-bold text-primary">${orgSummary.openSlots}</p>
          </div>
          <div>
            <p class="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Per Seat</p>
            <p class="text-lg font-bold text-slate-900 dark:text-slate-100">$${unitPrice}/mo</p>
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-card-border dark:border-primary/10">
          <div>
            <p class="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Org Credits</p>
            <p class="text-sm text-slate-700 dark:text-slate-300">
              <span class="font-semibold">${orgSummary.monthlyCredits}</span> monthly +
              <span class="font-semibold">${orgSummary.topUpCredits}</span> top-up
            </p>
          </div>
          <div>
            <p class="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Seat Change Lock</p>
            <div class="flex items-center gap-2">
              ${lockStatus}
              <span class="text-xs text-slate-500 dark:text-slate-400">${lockLabel}</span>
            </div>
            <p class="text-[10px] text-slate-400 mt-1">Remove seats before this date each period. After lock, removals take effect next period.</p>
          </div>
        </div>
      </div>
    `;
  }

  function escapeAttr(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderFaqFooter(): string {
    return `
      <div class="mt-12 pt-8 border-t border-card-border dark:border-primary/10">
        <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-4">Frequently asked questions</h3>
        <dl class="space-y-4">
          <div>
            <dt class="text-xs font-medium text-slate-700 dark:text-slate-300">What happens when I upgrade?</dt>
            <dd class="text-xs text-slate-500 dark:text-slate-400 mt-1">You’ll be redirected to Stripe Checkout to complete payment. Once subscribed, limits are removed and you get full access.</dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-slate-700 dark:text-slate-300">How do I cancel?</dt>
            <dd class="text-xs text-slate-500 dark:text-slate-400 mt-1">Click Manage Subscription to open the Stripe Customer Portal. There you can cancel or update your plan.</dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-slate-700 dark:text-slate-300">How do credits work?</dt>
            <dd class="text-xs text-slate-500 dark:text-slate-400 mt-1">Every plan includes a monthly credit allowance that resets each billing cycle. If you run out, you can purchase additional credit packs through the Stripe Customer Portal (click Manage Subscription). Free-tier users can upgrade to a paid plan to access credit packs.</dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-slate-700 dark:text-slate-300">How do limits work on the free plan?</dt>
            <dd class="text-xs text-slate-500 dark:text-slate-400 mt-1">Free users receive 25 credits per month and can create up to 3 prompt flows, 3 transcript flows, 3 transcript sets, and use each import feature once. Upgrade for more credits and unlimited access.</dd>
          </div>
        </dl>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-4">Need help? Email support@spoqen.com</p>
      </div>
    `;
  }

  function wireActions(): void {
    container.querySelector('#btn-manage-subscription')?.addEventListener('click', () => {
      void handleAction(() => createPortalSession());
    });

    container.querySelector('#btn-upgrade-enterprise')?.addEventListener('click', () => {
      void handleAction(() => createCheckoutSessionByTier('enterprise'));
    });

    container.querySelector('#btn-change-plan')?.addEventListener('click', () => {
      void handleAction(() => createPortalSession());
    });

    container.querySelector('#btn-add-member')?.addEventListener('click', () => {
      const input = container.querySelector<HTMLInputElement>('#add-member-email');
      const errorEl = container.querySelector<HTMLElement>('#add-member-error');
      const email = input?.value?.trim();
      if (!email) return;
      void (async () => {
        const result = await addPlanMember(email);
        if (result.success) {
          planMembers = await getPlanMembers();
          render();
        } else {
          if (errorEl) {
            errorEl.textContent = result.error ?? 'Failed to add member.';
            errorEl.classList.remove('hidden');
          }
        }
      })();
    });

    container.querySelectorAll<HTMLButtonElement>('.btn-remove-member').forEach(btn => {
      const membershipId = btn.dataset.membershipId;
      if (!membershipId) return;
      btn.addEventListener('click', () => {
        void (async () => {
          await removePlanMember(membershipId);
          planMembers = await getPlanMembers();
          render();
        })();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.btn-add-credits-member').forEach(btn => {
      const memberUserId = btn.dataset.memberUserId;
      if (!memberUserId) return;
      btn.addEventListener('click', () => {
        const amountStr = prompt('How many credits to add?', '50');
        if (!amountStr) return;
        const amount = parseInt(amountStr, 10);
        if (isNaN(amount) || amount <= 0) return;
        void (async () => {
          const result = await addCreditsToMember(memberUserId, amount);
          if (result.success) {
            planMembers = await getPlanMembers();
            render();
          } else {
            errorMessage = result.error ?? 'Failed to add credits.';
            render();
          }
        })();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.btn-subscribe').forEach(btn => {
      const tier = btn.dataset.tier as SubscriptionTier | undefined;
      if (!tier) return;
      if (limits?.hasFullAccess) {
        btn.addEventListener('click', () => router.navigate('/'));
        return;
      }
      btn.addEventListener('click', () => {
        void handleAction(() => createCheckoutSessionByTier(tier));
      });
    });
  }

  async function handleAction(action: () => Promise<void>): Promise<void> {
    actionLoading = true;
    errorMessage = '';
    render();
    try {
      await action();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Something went wrong.';
      actionLoading = false;
      render();
    }
  }

  render();

  void (async () => {
    try {
      const [subRes, limitsRes, creditsRes, planOwnerRes, orgRes] = await Promise.all([
        getSubscription(),
        getSubscriptionLimits(),
        getUserCredits(),
        getPlanOwner(),
        getOrgBillingSummary(),
      ]);
      subscription = subRes;
      limits = limitsRes;
      credits = creditsRes;
      planOwner = planOwnerRes;
      orgSummary = orgRes;

      if (subRes && (subRes.tier === 'growth' || subRes.tier === 'enterprise')) {
        planMembers = await getPlanMembers();
      }
    } catch (err) {
      console.error('Failed to load subscription:', err);
    }
    loading = false;
    render();
  })();
}
