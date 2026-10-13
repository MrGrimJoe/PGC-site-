import React from 'react';
import type { MeResponse } from '../../shared/schema.ts';
import { LogIn, Edit3, Eye, LogOut } from 'lucide-react';

interface NavbarProps {
  currentUser: MeResponse | null;
  activeTab: 'signin' | 'edit' | 'view';
  setActiveTab: (tab: 'signin' | 'edit' | 'view') => void;
  onLogout: () => Promise<void>;
  viewUsername: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  activeTab,
  setActiveTab,
  onLogout,
}) => {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold tracking-wider shadow-sm shadow-indigo-500/20">
            D
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-zinc-100 text-lg tracking-tight">Dialtone</span>
              <span className="text-xs bg-zinc-800 text-zinc-400 font-mono px-2 py-0.5 rounded border border-zinc-700/60">
                Milestone 1
              </span>
            </div>
            <p className="text-xs text-zinc-500 hidden sm:block">Cloudflare Worker · D1 · PKCE Auth</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center space-x-1 sm:space-x-2">
          {!currentUser ? (
            <button
              onClick={() => setActiveTab('signin')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'signin'
                  ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <LogIn className="w-4 h-4 text-indigo-400" />
              <span>Sign In</span>
            </button>
          ) : (
            <button
              onClick={() => setActiveTab('edit')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'edit'
                  ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
              }`}
            >
              <Edit3 className="w-4 h-4 text-emerald-400" />
              <span>Edit Profile</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('view')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              activeTab === 'view'
                ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
            }`}
          >
            <Eye className="w-4 h-4 text-cyan-400" />
            <span>Public Profile</span>
          </button>

          {currentUser && (
            <div className="flex items-center pl-2 sm:pl-3 border-l border-zinc-800 space-x-2">
              <div className="hidden md:flex flex-col text-right">
                <span className="text-xs font-medium text-zinc-200">{currentUser.profile.display_name}</span>
                <span className="text-[11px] text-zinc-400 font-mono">@{currentUser.profile.username}</span>
              </div>
              <button
                onClick={onLogout}
                title="Log out"
                className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-950/30 transition border border-transparent hover:border-red-900/40"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
};
