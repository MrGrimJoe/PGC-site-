import React from 'react';
import type { MeResponse } from '../../shared/schema.ts';
import { LogIn, LogOut, Home, PlusSquare, User } from 'lucide-react';

interface NavbarProps {
  currentUser: MeResponse | null;
  activeTab: 'feed' | 'post' | 'profile' | 'signin';
  setActiveTab: (tab: 'feed' | 'post' | 'profile' | 'signin') => void;
  onLogout: () => Promise<void>;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  activeTab,
  setActiveTab,
  onLogout,
}) => {
  return (
    <header className="border-b border-border bg-surface sticky top-0 z-40">
      <div className="max-w-[640px] mx-auto px-4 h-16 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setActiveTab(currentUser ? 'feed' : 'signin')}
          className="flex items-center space-x-2.5 text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-sm bg-primary text-on-primary flex items-center justify-center font-semibold text-base">
            D
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-text text-base tracking-tight">Dialtone</span>
            <span className="text-[12px] bg-accent text-accent-text font-semibold px-2 py-0.5 rounded-pill">
              M2
            </span>
          </div>
        </button>

        {/* Top Navigation Tabs */}
        <nav className="flex items-center space-x-1">
          {currentUser ? (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('feed')}
                className={`min-h-[44px] px-3 rounded-sm text-[13px] font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer hidden sm:flex ${
                  activeTab === 'feed'
                    ? 'bg-primary-tint text-primary'
                    : 'text-text-muted hover:text-text hover:bg-bg'
                }`}
              >
                <Home className="w-4 h-4" />
                <span>Feed</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('post')}
                className={`min-h-[44px] px-3 rounded-sm text-[13px] font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer hidden sm:flex ${
                  activeTab === 'post'
                    ? 'bg-primary-tint text-primary'
                    : 'text-text-muted hover:text-text hover:bg-bg'
                }`}
              >
                <PlusSquare className="w-4 h-4" />
                <span>Post</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('profile')}
                className={`min-h-[44px] px-3 rounded-sm text-[13px] font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer hidden sm:flex ${
                  activeTab === 'profile'
                    ? 'bg-primary-tint text-primary'
                    : 'text-text-muted hover:text-text hover:bg-bg'
                }`}
              >
                <User className="w-4 h-4" />
                <span>Profile</span>
              </button>

              <button
                type="button"
                onClick={onLogout}
                title="Log out"
                aria-label="Log out"
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-sm text-text-muted hover:text-danger hover:bg-danger-tint transition-colors flex items-center justify-center cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setActiveTab('signin')}
              className={`min-h-[44px] px-3 rounded-sm text-[14px] font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer ${
                activeTab === 'signin'
                  ? 'bg-primary-tint text-primary'
                  : 'text-text-muted hover:text-text hover:bg-bg'
              }`}
            >
              <LogIn className="w-4 h-4" />
              <span>Sign In</span>
            </button>
          )}
        </nav>
      </div>
    </header>
  );
};
