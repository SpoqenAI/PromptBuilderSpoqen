import type { User } from '@supabase/supabase-js';
import { router } from '../router';
import {
  getCurrentUser,
  getOnboardingProfile,
  isOnboardingComplete,
  saveOnboardingProfile,
  signInWithPassword,
  signOut,
  signUpWithPassword,
} from '../auth';
import { themeToggleHTML, wireThemeToggle } from '../theme';

type AuthMode = 'sign-in' | 'sign-up';

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
}

interface TurnstileApi {
  render(target: HTMLElement | string, options: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Turnstile script')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Turnstile script'));
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

function authCardShell(title: string, subtitle: string, body: string): string {
  return `
    <div class="min-h-screen bg-gradient-to-br from-slate-100 via-white to-emerald-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-4">
      <div class="w-full max-w-md">
        <div class="mb-6 flex items-center justify-between">
          <img src="${import.meta.env.BASE_URL}Spoqen-2.svg" alt="Spoqen" class="h-9 w-auto" />
          <div class="flex items-center gap-2">${themeToggleHTML()}</div>
        </div>

        <div class="bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 shadow-xl rounded-2xl p-6">
          <h1 class="text-xl font-semibold text-slate-900 dark:text-white">${title}</h1>
          <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">${subtitle}</p>
          <div class="mt-6">${body}</div>
        </div>
      </div>
    </div>
  `;
}

function setMessage(container: HTMLElement, tone: 'error' | 'success' | 'info', message: string): void {
  const panel = container.querySelector<HTMLElement>('#auth-message');
  if (!panel) return;

  panel.classList.remove('hidden', 'text-red-700', 'bg-red-50', 'border-red-200', 'text-emerald-700', 'bg-emerald-50', 'border-emerald-200', 'text-slate-700', 'bg-slate-50', 'border-slate-200');
  if (tone === 'error') {
    panel.classList.add('text-red-700', 'bg-red-50', 'border-red-200');
  } else if (tone === 'success') {
    panel.classList.add('text-emerald-700', 'bg-emerald-50', 'border-emerald-200');
  } else {
    panel.classList.add('text-slate-700', 'bg-slate-50', 'border-slate-200');
  }
  panel.textContent = message;
}

function clearMessage(container: HTMLElement): void {
  const panel = container.querySelector<HTMLElement>('#auth-message');
  if (!panel) return;
  panel.className = 'hidden text-sm border rounded-lg px-3 py-2';
  panel.textContent = '';
}

function getAuthFriendlyError(error: string): string {
  const value = error.toLowerCase();
  if (value.includes('email not confirmed')) {
    return 'Please verify your email first. Check your inbox and spam folder for the confirmation link.';
  }
  if (value.includes('invalid login credentials')) {
    return 'Incorrect email or password.';
  }
  if (value.includes('captcha')) {
    return 'Captcha validation failed. Please complete captcha and try again.';
  }
  return error;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function renderAuthPage(container: HTMLElement, mode: AuthMode): void {
  const isSignUp = mode === 'sign-up';
  const alternateLabel = isSignUp ? 'Sign in' : 'Create account';
  const alternateRoute = isSignUp ? '/auth/sign-in' : '/auth/sign-up';

  container.innerHTML = authCardShell(
    isSignUp ? 'Create your account' : 'Sign in to Spoqen',
    isSignUp
      ? 'Use your work email and verify your account to activate cloud sync.'
      : 'Sign in to continue to your project dashboard.',
    `
      <form id="auth-form" class="space-y-4">
        ${isSignUp ? `
          <div>
            <label for="auth-full-name" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Full Name</label>
            <input id="auth-full-name" type="text" autocomplete="name" class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" placeholder="Alex Morgan" />
          </div>
        ` : ''}

        <div>
          <label for="auth-email" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Email</label>
          <input id="auth-email" type="email" autocomplete="email" required class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" placeholder="you@company.com" />
        </div>

        <div>
          <label for="auth-password" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Password</label>
          <input id="auth-password" type="password" autocomplete="${isSignUp ? 'new-password' : 'current-password'}" required class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" placeholder="${isSignUp ? 'At least 8 characters' : 'Your password'}" />
        </div>

        ${isSignUp ? `
          <div>
            <label for="auth-confirm-password" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Confirm Password</label>
            <input id="auth-confirm-password" type="password" autocomplete="new-password" required class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
        ` : ''}

        <div id="captcha-wrap" class="space-y-2">
          <div id="captcha-widget"></div>
          <p id="captcha-hint" class="text-xs text-slate-500"></p>
        </div>

        <div id="auth-message" class="hidden text-sm border rounded-lg px-3 py-2"></div>

        <button id="auth-submit" type="submit" class="w-full rounded-lg bg-primary text-white font-medium py-2.5 hover:bg-primary/90 transition-colors">
          ${isSignUp ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p class="mt-4 text-sm text-slate-600 dark:text-slate-300">
        ${isSignUp ? 'Already have an account?' : 'Need an account?'}
        <a id="auth-switch-link" href="#${alternateRoute}" class="text-primary font-semibold">${alternateLabel}</a>
      </p>
    `,
  );

  wireThemeToggle(container);

  const form = container.querySelector<HTMLFormElement>('#auth-form');
  const submitButton = container.querySelector<HTMLButtonElement>('#auth-submit');
  const captchaHint = container.querySelector<HTMLElement>('#captcha-hint');
  const captchaWidget = container.querySelector<HTMLElement>('#captcha-widget');

  if (!form || !submitButton || !captchaHint || !captchaWidget) return;

  let captchaToken = '';
  let captchaWidgetId: string | null = null;
  const captchaEnabled = parseBooleanEnv(import.meta.env.NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED, true);
  const captchaSiteKey = import.meta.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const captchaRequired = captchaEnabled;

  const resetCaptcha = () => {
    captchaToken = '';
    if (captchaWidgetId && window.turnstile) {
      window.turnstile.reset(captchaWidgetId);
    }
  };

  if (!captchaEnabled) {
    captchaHint.textContent = 'Captcha is temporarily disabled by NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED=false.';
    captchaWidget.classList.add('hidden');
  } else if (!captchaSiteKey) {
    captchaHint.textContent = 'Captcha is not configured. Set NEXT_PUBLIC_TURNSTILE_SITE_KEY in .env.';
    submitButton.disabled = true;
    submitButton.classList.add('opacity-60', 'cursor-not-allowed');
  } else {
    void loadTurnstileScript()
      .then(() => {
        if (!window.turnstile) {
          throw new Error('Turnstile API is unavailable');
        }
        captchaWidgetId = window.turnstile.render(captchaWidget, {
          sitekey: captchaSiteKey,
          callback: (token: string) => {
            captchaToken = token;
            captchaHint.textContent = 'Captcha verified.';
          },
          'expired-callback': () => {
            captchaToken = '';
            captchaHint.textContent = 'Captcha expired. Please verify again.';
          },
          'error-callback': () => {
            captchaToken = '';
            captchaHint.textContent = 'Captcha failed to load. Please refresh.';
          },
          theme: 'auto',
        });
        captchaHint.textContent = 'Complete captcha before continuing.';
      })
      .catch((err: unknown) => {
        captchaHint.textContent = getAuthFriendlyError(String(err));
        submitButton.disabled = true;
        submitButton.classList.add('opacity-60', 'cursor-not-allowed');
      });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearMessage(container);

    const email = (container.querySelector<HTMLInputElement>('#auth-email')?.value ?? '').trim().toLowerCase();
    const password = container.querySelector<HTMLInputElement>('#auth-password')?.value ?? '';

    if (!email || !password) {
      setMessage(container, 'error', 'Email and password are required.');
      return;
    }

    if (captchaRequired && !captchaToken) {
      setMessage(container, 'error', 'Please complete captcha before continuing.');
      return;
    }

    submitButton.disabled = true;
    submitButton.classList.add('opacity-70', 'cursor-not-allowed');

    void (async () => {
      try {
        if (isSignUp) {
          const fullName = (container.querySelector<HTMLInputElement>('#auth-full-name')?.value ?? '').trim();
          const confirmPassword = container.querySelector<HTMLInputElement>('#auth-confirm-password')?.value ?? '';

          if (fullName.length < 2) {
            throw new Error('Please enter your full name.');
          }
          if (password.length < 8) {
            throw new Error('Use at least 8 characters for your password.');
          }
          if (password !== confirmPassword) {
            throw new Error('Passwords do not match.');
          }

          const signUp = await signUpWithPassword(email, password, fullName, captchaEnabled ? captchaToken : undefined);
          if (signUp.duplicateAccount) {
            setMessage(container, 'error', 'An account with this email already exists. Sign in instead.');
            return;
          }
          if (signUp.emailVerificationRequired) {
            setMessage(container, 'success', 'Account created. Check your email to verify your account, then sign in.');
            return;
          }

          const user = await getCurrentUser();
          if (!user) {
            throw new Error('Sign-up finished but no session was created. Please sign in.');
          }
          router.navigate('/auth/onboarding');
          return;
        }

        await signInWithPassword(email, password, captchaEnabled ? captchaToken : undefined);
        const user = await getCurrentUser();
        if (!user) {
          throw new Error('Sign-in succeeded but no active session was found.');
        }

        const onboardingDone = await isOnboardingComplete(user.id);
        router.navigate(onboardingDone ? '/' : '/auth/onboarding');
      } catch (err) {
        setMessage(container, 'error', getAuthFriendlyError(String(err instanceof Error ? err.message : err)));
        resetCaptcha();
      } finally {
        submitButton.disabled = false;
        submitButton.classList.remove('opacity-70', 'cursor-not-allowed');
      }
    })();
  });
}

export async function renderOnboardingPage(container: HTMLElement, user: User): Promise<void> {
  const profile = await getOnboardingProfile(user.id);
  const profileName = profile?.full_name || ((user.user_metadata.full_name as string | undefined) ?? '');

  container.innerHTML = authCardShell(
    'Welcome to Spoqen',
    'Help us personalize your workspace with a few quick onboarding questions.',
    `
      <form id="onboarding-form" class="space-y-4">
        <div>
          <label for="ob-full-name" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Full Name</label>
          <input id="ob-full-name" type="text" class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" value="${escapeHtml(profileName)}" required />
        </div>

        <div>
          <label for="ob-role" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Role</label>
          <select id="ob-role" class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
            ${selectOptions(['Founder', 'Product Manager', 'Engineer', 'Designer', 'Marketer', 'Operations', 'Other'], profile?.role)}
          </select>
        </div>

        <div>
          <label for="ob-heard-about" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">How did you hear about Spoqen?</label>
          <select id="ob-heard-about" class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
            ${selectOptions(['Search engine', 'Social media', 'Friend or colleague', 'Community', 'Newsletter', 'Event', 'Other'], profile?.heard_about)}
          </select>
        </div>

        <div>
          <label for="ob-team-size" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Team Size</label>
          <select id="ob-team-size" class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
            ${selectOptions(['Solo', '2-5', '6-20', '21-100', '101+'], profile?.team_size)}
          </select>
        </div>

        <div>
          <label for="ob-goal" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Primary Goal</label>
          <textarea id="ob-goal" rows="3" class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" placeholder="What do you want to achieve with Spoqen?">${escapeHtml(profile?.primary_goal ?? '')}</textarea>
        </div>

        <div>
          <label for="ob-use-case" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Primary Use Case</label>
          <textarea id="ob-use-case" rows="3" class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" placeholder="Example: customer support voice assistant prompts">${escapeHtml(profile?.primary_use_case ?? '')}</textarea>
        </div>

        <div id="onboarding-message" class="hidden text-sm border rounded-lg px-3 py-2"></div>

        <div class="flex items-center gap-3 pt-2">
          <button id="onboarding-submit" type="submit" class="flex-1 rounded-lg bg-primary text-white font-medium py-2.5 hover:bg-primary/90 transition-colors">Finish setup</button>
          <button id="onboarding-sign-out" type="button" class="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2.5 text-sm">Sign out</button>
        </div>
      </form>
    `,
  );

  wireThemeToggle(container);

  const form = container.querySelector<HTMLFormElement>('#onboarding-form');
  const submitButton = container.querySelector<HTMLButtonElement>('#onboarding-submit');
  const signOutButton = container.querySelector<HTMLButtonElement>('#onboarding-sign-out');
  const messagePanel = container.querySelector<HTMLElement>('#onboarding-message');

  if (!form || !submitButton || !messagePanel || !signOutButton) return;

  const setOnboardingMessage = (tone: 'error' | 'success', message: string) => {
    messagePanel.classList.remove('hidden', 'text-red-700', 'bg-red-50', 'border-red-200', 'text-emerald-700', 'bg-emerald-50', 'border-emerald-200');
    if (tone === 'error') {
      messagePanel.classList.add('text-red-700', 'bg-red-50', 'border-red-200');
    } else {
      messagePanel.classList.add('text-emerald-700', 'bg-emerald-50', 'border-emerald-200');
    }
    messagePanel.textContent = message;
  };

  signOutButton.addEventListener('click', () => {
    void (async () => {
      try {
        await signOut();
        router.navigate('/auth/sign-in');
      } catch (err) {
        setOnboardingMessage('error', String(err instanceof Error ? err.message : err));
      }
    })();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    messagePanel.className = 'hidden text-sm border rounded-lg px-3 py-2';
    messagePanel.textContent = '';

    const fullName = (container.querySelector<HTMLInputElement>('#ob-full-name')?.value ?? '').trim();
    const role = (container.querySelector<HTMLSelectElement>('#ob-role')?.value ?? '').trim();
    const heardAbout = (container.querySelector<HTMLSelectElement>('#ob-heard-about')?.value ?? '').trim();
    const teamSize = (container.querySelector<HTMLSelectElement>('#ob-team-size')?.value ?? '').trim();
    const primaryGoal = (container.querySelector<HTMLTextAreaElement>('#ob-goal')?.value ?? '').trim();
    const primaryUseCase = (container.querySelector<HTMLTextAreaElement>('#ob-use-case')?.value ?? '').trim();

    if (!fullName || !role || !heardAbout || !teamSize || !primaryGoal || !primaryUseCase) {
      setOnboardingMessage('error', 'Please complete all onboarding fields.');
      return;
    }

    submitButton.disabled = true;
    submitButton.classList.add('opacity-70', 'cursor-not-allowed');

    void (async () => {
      try {
        await saveOnboardingProfile(user, {
          fullName,
          role,
          heardAbout,
          teamSize,
          primaryGoal,
          primaryUseCase,
        });
        setOnboardingMessage('success', 'Profile saved. Redirecting to dashboard...');
        router.navigate('/');
      } catch (err) {
        setOnboardingMessage('error', String(err instanceof Error ? err.message : err));
      } finally {
        submitButton.disabled = false;
        submitButton.classList.remove('opacity-70', 'cursor-not-allowed');
      }
    })();
  });
}

function selectOptions(options: string[], selected: string | undefined): string {
  return options
    .map((option) => `<option value="${escapeHtml(option)}" ${selected === option ? 'selected' : ''}>${escapeHtml(option)}</option>`)
    .join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
