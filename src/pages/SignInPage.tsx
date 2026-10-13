import React, { useState } from 'react';
import { Lock, ShieldCheck, ArrowRight } from 'lucide-react';

interface SignInPageProps {
  onSuccessRedirect?: () => void;
}

export const SignInPage: React.FC<SignInPageProps> = () => {
  const [loading, setLoading] = useState<string | null>(null);

  const handleGoogleSignIn = (mock = false) => {
    setLoading(mock ? 'mock' : 'real');
    const url = mock ? '/api/auth/google?mock=true' : '/api/auth/google';
    window.location.href = url;
  };

  return (
    <div className="w-full max-w-[640px] mx-auto py-8 px-4">
      <div className="bg-surface border border-border rounded-card p-4 shadow-card space-y-4">
        {/* Header */}
        <div className="text-center py-2 space-y-1.5">
          <div className="w-10 h-10 rounded-sm bg-primary-tint text-primary flex items-center justify-center mx-auto mb-2">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="text-[24px] font-semibold text-text tracking-tight">Sign In</h1>
          <p className="text-[14px] text-text-muted">
            Authentication with Cloudflare Workers, D1, and Google OAuth
          </p>
        </div>

        {/* Security Specifications Card */}
        <div className="border border-border rounded-sm p-3.5 bg-bg space-y-2 text-[12px] text-text-muted">
          <div className="flex items-center space-x-1.5 font-semibold text-text">
            <span className="w-2 h-2 rounded-pill bg-accent inline-block" />
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span>Architecture & Security</span>
          </div>
          <ul className="space-y-1.5 pl-5 list-disc">
            <li>
              <strong>OAuth 2.0 PKCE:</strong> SHA-256 code challenge with state and nonce verification.
            </li>
            <li>
              <strong>HttpOnly Session Cookie:</strong> Cookies are <code className="text-text font-mono">HttpOnly; Secure; SameSite=Lax</code>. Zero tokens in localStorage.
            </li>
            <li>
              <strong>D1 Isolated Storage:</strong> Parameterized SQL only. Email is excluded from storage.
            </li>
          </ul>
        </div>

        {/* Actions: One Primary Blue Button */}
        <div className="space-y-3 pt-2">
          {/* Primary Action Button */}
          <button
            type="button"
            onClick={() => handleGoogleSignIn(false)}
            disabled={loading !== null}
            className="w-full min-h-[44px] px-4 rounded-sm bg-primary hover:bg-primary-hover text-on-primary font-semibold text-[14px] flex items-center justify-center space-x-2 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <span>{loading === 'real' ? 'Redirecting to Google...' : 'Continue with Google'}</span>
            <ArrowRight className="w-4 h-4 ml-1" />
          </button>

          {/* Secondary Action: Outlined Button */}
          <button
            type="button"
            onClick={() => handleGoogleSignIn(true)}
            disabled={loading !== null}
            className="w-full min-h-[44px] px-4 rounded-sm bg-surface hover:bg-primary-tint border border-border text-text font-semibold text-[14px] flex items-center justify-center space-x-2 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <span>
              {loading === 'mock' ? 'Executing PKCE flow...' : 'Development Sign-In (Simulation)'}
            </span>
          </button>
          <p className="text-[12px] text-text-muted text-center">
            Development mode simulation verifies state, nonce, and D1 batch insertion without live Google keys.
          </p>
        </div>
      </div>
    </div>
  );
};
