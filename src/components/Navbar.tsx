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
    <header className="border-b border-border bg-surface sticky top-0 z-40">
      <div className="max-w-[640px] mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-sm bg-primary text-on-primary flex items-center justify-center font-semibold text-base">
            D
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-text text-base tracking-tight">Dialtone</span>
            <span className="text-[12px] bg-accent text-accent-text font-semibold px-2 py-0.5 rounded-pill">
              M1
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center space-x-1">
          {!currentUser ? (
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
          ) : (
            <button
              type="button"
              onClick={() => setActiveTab('edit')}
              className={`min-h-[44px] px-3 rounded-sm text-[14px] font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer ${
                activeTab === 'edit'
                  ? 'bg-primary-tint text-primary'
                  : 'text-text-muted hover:text-text hover:bg-bg'
              }`}
            >
              <Edit3 className="w-4 h-4" />
              <span>Edit Profile</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('view')}
            className={`min-h-[44px] px-3 rounded-sm text-[14px] font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer ${
              activeTab === 'view'
                ? 'bg-primary-tint text-primary'
                : 'text-text-muted hover:text-text hover:bg-bg'
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>Profile</span>
          </button>

          {currentUser && (
            <button
              type="button"
              onClick={onLogout}
              title="Log out"
              aria-label="Log out"
              className="min-h-[44px] min-w-[44px] p-2.5 rounded-sm text-text-muted hover:text-danger hover:bg-danger-tint transition-colors flex items-center justify-center cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </nav>
      </div>
    </header>
  );
};
