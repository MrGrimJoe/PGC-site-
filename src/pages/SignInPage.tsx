import React, { useState } from 'react';
import { ShieldCheck, Lock, ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';

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
    <div className="max-w-xl mx-auto py-12 px-4">
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-xl shadow-black/40">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 mb-4">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">Sign In to Dialtone</h1>
          <p className="text-sm text-zinc-400 mt-2">
            Secure authentication powered by Cloudflare Worker & D1 database
          </p>
        </div>

        {/* Security architecture highlights */}
        <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-4 mb-6 text-xs text-zinc-400 space-y-2.5">
          <div className="flex items-center text-zinc-300 font-semibold mb-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400 mr-1.5" />
            <span>Milestone 1 Architecture Specifications:</span>
          </div>
          <div className="flex items-start space-x-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              <strong>OAuth 2.0 PKCE:</strong> Authorization Code flow with SHA-256 code challenge, random state, and nonce.
            </span>
          </div>
          <div className="flex items-start space-x-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              <strong>HttpOnly Session Cookie:</strong> No tokens stored in localStorage. Cookies are <code className="text-zinc-300">HttpOnly</code>, <code className="text-zinc-300">Secure</code>, <code className="text-zinc-300">SameSite=Lax</code>.
            </span>
          </div>
          <div className="flex items-start space-x-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              <strong>Cloudflare D1:</strong> Parameterized SQL queries against isolated SQLite database.
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {/* Real Google Sign-in */}
          <button
            onClick={() => handleGoogleSignIn(false)}
            disabled={loading !== null}
            className="w-full flex items-center justify-center space-x-3 py-3 px-4 rounded-xl bg-white hover:bg-zinc-100 text-zinc-900 font-medium transition shadow-sm hover:shadow active:scale-[0.99] disabled:opacity-60 cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.97 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            <span>{loading === 'real' ? 'Redirecting to Google...' : 'Continue with Google'}</span>
            <ArrowRight className="w-4 h-4 text-zinc-500 ml-auto" />
          </button>

          {/* Development / Mock sign-in */}
          <div className="pt-2">
            <button
              onClick={() => handleGoogleSignIn(true)}
              disabled={loading !== null}
              className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-750 text-zinc-300 hover:text-white text-sm font-medium border border-zinc-700/80 transition cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>
                {loading === 'mock'
                  ? 'Executing PKCE flow...'
                  : 'Test OAuth Flow (Local Dev Simulation)'}
              </span>
            </button>
            <p className="text-[11px] text-zinc-500 text-center mt-1.5">
              Simulates the full Authorization Code + PKCE + State/Nonce verification in development mode without external Google credentials.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
