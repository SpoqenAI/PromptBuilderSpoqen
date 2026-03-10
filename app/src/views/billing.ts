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

export function renderBilling(container: HTMLElement): void {
  let subscription: Subscription | null = null;
  let limits: SubscriptionLimits | null = null;
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
    return 'You\'re on the free plan. Limits: 3 prompt flows, 3 transcript flows, 3 transcript sets, 1 import each.';
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
        <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
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
      return renderCurrentPlan(subscription);
    }
    return renderPricingCards();
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
          ${sub.tier === 'individual' ? `
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
    const individualFeatures = [
      'Unlimited prompt flows',
      'Unlimited transcript flows & imports',
      'Transcript import & flow mapping',
      'GitHub sync',
      'Version history & diff',
      'Session replay (Sentry)',
    ];
    const enterpriseFeatures = [
      'Everything in Individual',
      'Priority support',
      'Advanced analytics',
      'Custom node templates',
      'Prompt optimization runs',
      'Team collaboration (coming soon)',
    ];

    return `
      <div class="text-center mb-8">
        <h2 class="text-2xl font-bold text-slate-900 dark:text-slate-100">Choose your plan</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-2">Get started with Spoqen and unlock the full power of prompt engineering.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        ${renderPricingCard({
          tier: 'individual',
          title: 'Individual',
          description: 'For solo builders and prompt engineers.',
          features: individualFeatures,
          cta: 'Get Started',
          highlight: false,
          disabled: limits?.hasFullAccess ?? false,
        })}
        ${renderPricingCard({
          tier: 'enterprise',
          title: 'Enterprise',
          description: 'For teams building production voice AI.',
          features: enterpriseFeatures,
          cta: 'Get Started',
          highlight: true,
          disabled: limits?.hasFullAccess ?? false,
        })}
      </div>
      <p class="text-center text-xs text-slate-500 dark:text-slate-400 mt-4">No long-term commitment. Cancel anytime in Stripe.</p>
    `;
  }

  function renderPricingCard(card: {
    tier: SubscriptionTier;
    title: string;
    description: string;
    features: string[];
    cta: string;
    highlight: boolean;
    disabled?: boolean;
  }): string {
    const borderClass = card.highlight
      ? 'border-primary ring-1 ring-primary/20'
      : 'border-card-border dark:border-primary/20';
    const badge = card.highlight
      ? '<span class="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary text-white text-[10px] font-bold px-3 py-1 uppercase tracking-wider">Popular</span>'
      : '';

    const btnDisabled = card.disabled || actionLoading;
    const btnContent = card.disabled
      ? 'Full access (team/beta)'
      : card.cta;

    return `
      <div class="relative rounded-xl border ${borderClass} bg-white dark:bg-slate-900 p-6 shadow-sm flex flex-col">
        ${badge}
        <h3 class="text-lg font-bold text-slate-900 dark:text-slate-100">${card.title}</h3>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-5">${card.description}</p>

        <ul class="space-y-2 mb-6 flex-1">
          ${card.features.map(f => `
            <li class="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <span class="material-icons-outlined text-primary text-base mt-0.5">check_circle</span>
              ${f}
            </li>
          `).join('')}
        </ul>

        <button data-tier="${card.tier}" type="button" class="btn-subscribe w-full rounded-lg ${card.highlight ? 'bg-primary text-white hover:bg-primary/90' : 'border border-primary text-primary hover:bg-primary/5'} px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed" ${btnDisabled ? 'disabled' : ''} title="${card.disabled ? 'Billing is handled by your team; your account already has full access.' : ''}">
          ${actionLoading && !card.disabled ? 'Loading...' : btnContent}
        </button>
      </div>
    `;
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
            <dt class="text-xs font-medium text-slate-700 dark:text-slate-300">How do limits work on the free plan?</dt>
            <dd class="text-xs text-slate-500 dark:text-slate-400 mt-1">Free users can create up to 3 prompt flows, 3 transcript flows, 3 transcript sets, and use each import feature once. Upgrade to Pro for unlimited access.</dd>
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
      const [subRes, limitsRes] = await Promise.all([
        getSubscription(),
        getSubscriptionLimits(),
      ]);
      subscription = subRes;
      limits = limitsRes;
    } catch (err) {
      console.error('Failed to load subscription:', err);
    }
    loading = false;
    render();
  })();
}
