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

export function renderBilling(container: HTMLElement): void {
  let subscription: Subscription | null = null;
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

  function render(): void {
    container.innerHTML = `
      <header class="ui-header z-20">
        <div class="ui-header-left">
          <button type="button" class="w-8 h-8 flex items-center justify-center cursor-pointer rounded" id="nav-home" aria-label="Go to dashboard">
            <img src="/Icon.svg" alt="Spoqen" class="w-8 h-8 object-contain" />
          </button>
          <div class="min-w-0">
            <h1 class="text-sm font-semibold leading-none">Billing</h1>
            <span class="text-[10px] text-slate-400 uppercase tracking-wider">Manage your subscription</span>
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
          ${loading ? renderLoading() : renderContent()}
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
    if (subscription) {
      return renderCurrentPlan(subscription);
    }
    return renderPricingCards();
  }

  function renderCurrentPlan(sub: Subscription): string {
    const renewalNote = sub.cancelAtPeriodEnd
      ? `<span class="text-amber-600 dark:text-amber-400">Cancels ${formatPeriodEnd(sub.currentPeriodEnd)}</span>`
      : `Renews ${formatPeriodEnd(sub.currentPeriodEnd)}`;

    return `
      <div class="rounded-xl border border-card-border dark:border-primary/20 bg-white dark:bg-slate-900 p-6 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Current Plan</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${statusColor(sub.status)} bg-current/10">
            <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
            ${statusLabel(sub.status)}
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div>
            <p class="text-xs text-slate-500 dark:text-slate-400 mb-1">Plan</p>
            <p class="text-sm font-semibold text-slate-800 dark:text-slate-200">${tierLabel(sub.tier)}</p>
          </div>
          <div>
            <p class="text-xs text-slate-500 dark:text-slate-400 mb-1">Billing period</p>
            <p class="text-sm text-slate-700 dark:text-slate-300">${renewalNote}</p>
          </div>
        </div>

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
    `;
  }

  function renderPricingCards(): string {
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
          features: [
            'Unlimited prompt projects',
            'Transcript import & flow mapping',
            'GitHub sync',
            'Version history & diff',
            'Session replay (Sentry)',
          ],
          cta: 'Get Started',
          highlight: false,
        })}
        ${renderPricingCard({
          tier: 'enterprise',
          title: 'Enterprise',
          description: 'For teams building production voice AI.',
          features: [
            'Everything in Individual',
            'Priority support',
            'Advanced analytics',
            'Custom node templates',
            'Prompt optimization runs',
            'Team collaboration (coming soon)',
          ],
          cta: 'Get Started',
          highlight: true,
        })}
      </div>
    `;
  }

  function renderPricingCard(card: {
    tier: SubscriptionTier;
    title: string;
    description: string;
    features: string[];
    cta: string;
    highlight: boolean;
  }): string {
    const borderClass = card.highlight
      ? 'border-primary ring-1 ring-primary/20'
      : 'border-card-border dark:border-primary/20';
    const badge = card.highlight
      ? '<span class="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary text-white text-[10px] font-bold px-3 py-1 uppercase tracking-wider">Popular</span>'
      : '';

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

        <button data-tier="${card.tier}" type="button" class="btn-subscribe w-full rounded-lg ${card.highlight ? 'bg-primary text-white hover:bg-primary/90' : 'border border-primary text-primary hover:bg-primary/5'} px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50" ${actionLoading ? 'disabled' : ''}>
          ${actionLoading ? 'Loading...' : card.cta}
        </button>
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

    container.querySelectorAll<HTMLButtonElement>('.btn-subscribe').forEach(btn => {
      const tier = btn.dataset.tier as SubscriptionTier | undefined;
      if (!tier) return;
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
      subscription = await getSubscription();
    } catch (err) {
      console.error('Failed to load subscription:', err);
    }
    loading = false;
    render();
  })();
}
