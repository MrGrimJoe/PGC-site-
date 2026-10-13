/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { MeResponse } from '../shared/schema.ts';
import { Navbar } from './components/Navbar.tsx';
import { BottomTabBar } from './components/BottomTabBar.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { FeedPage } from './pages/FeedPage.tsx';
import { PostComposerPage } from './pages/PostComposerPage.tsx';
import { ProfileEditPage } from './pages/ProfileEditPage.tsx';
import { ProfileViewPage } from './pages/ProfileViewPage.tsx';
// DEV-ONLY: remove before launch
import { DevBar } from './components/DevBar.tsx';

export default function App() {
  const [currentUser, setCurrentUser] = useState<MeResponse | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [activeTab, setActiveTab] = useState<'feed' | 'post' | 'profile' | 'signin'>('feed');
  const [profileSubView, setProfileSubView] = useState<'view' | 'edit'>('view');
  const [viewUsername, setViewUsername] = useState<string>('');

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        const data = (await res.json()) as MeResponse;
        setCurrentUser(data);
        setActiveTab('feed');
      } else {
        setCurrentUser(null);
        setActiveTab('signin');
      }
    } catch {
      setCurrentUser(null);
      setActiveTab('signin');
    } finally {
      setLoadingUser(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    } finally {
      setCurrentUser(null);
      setActiveTab('signin');
    }
  };

  const handleProfileUpdated = (updated: MeResponse) => {
    setCurrentUser(updated);
    setProfileSubView('view');
    setViewUsername(updated.profile.username);
  };

  const handleAccountDeleted = () => {
    setCurrentUser(null);
    setActiveTab('signin');
  };

  const handleViewAuthorProfile = (username: string) => {
    setViewUsername(username);
    setProfileSubView('view');
    setActiveTab('profile');
  };

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center text-text-muted">
        <div className="flex items-center space-x-2.5 text-[14px]">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-pill animate-spin" />
          <span>Loading Dialtone...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col font-sans pb-20">
      <Navbar
        currentUser={currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={handleLogout}
      />

      <main className="flex-1 w-full">
        {activeTab === 'signin' && (
          <SignInPage onSuccessRedirect={() => checkAuth()} />
        )}

        {activeTab === 'feed' && currentUser && (
          <FeedPage
            currentUserId={currentUser.user.id}
            onNavigateToCompose={() => setActiveTab('post')}
            onViewAuthorProfile={handleViewAuthorProfile}
          />
        )}

        {activeTab === 'post' && currentUser && (
          <PostComposerPage
            onPostCreated={() => setActiveTab('feed')}
          />
        )}

        {activeTab === 'profile' && currentUser && profileSubView === 'edit' && (
          <ProfileEditPage
            currentUser={currentUser}
            onProfileUpdated={handleProfileUpdated}
            onAccountDeleted={handleAccountDeleted}
            onViewPublicProfile={(u) => {
              setViewUsername(u);
              setProfileSubView('view');
            }}
          />
        )}

        {activeTab === 'profile' && currentUser && profileSubView === 'view' && (
          <ProfileViewPage
            initialUsername={viewUsername || currentUser.profile.username}
            currentUserId={currentUser.user.id}
            onNavigateToEditProfile={() => setProfileSubView('edit')}
          />
        )}

        {(!currentUser && activeTab !== 'signin') && (
          <SignInPage onSuccessRedirect={() => checkAuth()} />
        )}
      </main>

      <footer className="border-t border-border py-4 text-center text-[12px] text-text-muted hidden sm:block">
        Dialtone · Ephemeral Social Network · Milestone 2
      </footer>

      {/* Mobile-first bottom tab bar */}
      <BottomTabBar
        activeTab={activeTab}
        setActiveTab={(tab) => {
          if (tab === 'profile') {
            setViewUsername(currentUser?.profile.username || '');
            setProfileSubView('view');
          }
          setActiveTab(tab);
        }}
        isAuthenticated={!!currentUser}
      />

      {/* DEV-ONLY: remove before launch */}
      <DevBar currentUser={currentUser} onLogout={handleLogout} />
    </div>
  );
}
