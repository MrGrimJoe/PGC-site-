import React from 'react';
import { Home, PlusSquare, User } from 'lucide-react';

interface BottomTabBarProps {
  activeTab: 'feed' | 'post' | 'profile' | 'signin';
  setActiveTab: (tab: 'feed' | 'post' | 'profile' | 'signin') => void;
  isAuthenticated: boolean;
}

export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  activeTab,
  setActiveTab,
  isAuthenticated,
}) => {
  if (!isAuthenticated) return null;

  return (
    <nav
      aria-label="Mobile Navigation Bar"
      className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-border shadow-card"
    >
      <div className="max-w-[640px] mx-auto h-14 px-4 flex items-center justify-around">
        {/* Feed Tab */}
        <button
          type="button"
          onClick={() => setActiveTab('feed')}
          className={`flex-1 h-full flex flex-col items-center justify-center space-y-1 transition-colors cursor-pointer ${
            activeTab === 'feed'
              ? 'text-primary font-semibold'
              : 'text-text-muted hover:text-text'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[11px]">Feed</span>
        </button>

        {/* Post Composer Tab */}
        <button
          type="button"
          onClick={() => setActiveTab('post')}
          className={`flex-1 h-full flex flex-col items-center justify-center space-y-1 transition-colors cursor-pointer ${
            activeTab === 'post'
              ? 'text-primary font-semibold'
              : 'text-text-muted hover:text-text'
          }`}
        >
          <PlusSquare className="w-5 h-5" />
          <span className="text-[11px]">Post</span>
        </button>

        {/* Profile Tab */}
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`flex-1 h-full flex flex-col items-center justify-center space-y-1 transition-colors cursor-pointer ${
            activeTab === 'profile'
              ? 'text-primary font-semibold'
              : 'text-text-muted hover:text-text'
          }`}
        >
          <User className="w-5 h-5" />
          <span className="text-[11px]">Profile</span>
        </button>
      </div>
    </nav>
  );
};
