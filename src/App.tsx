/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { MeResponse } from '../shared/schema.ts';
import { Navbar } from './components/Navbar.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { ProfileEditPage } from './pages/ProfileEditPage.tsx';
import { ProfileViewPage } from './pages/ProfileViewPage.tsx';

export default function App() {
  const [currentUser, setCurrentUser] = useState<MeResponse | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [activeTab, setActiveTab] = useState<'signin' | 'edit' | 'view'>('signin');
  const [viewUsername, setViewUsername] = useState<string>('');

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        const data = (await res.json()) as MeResponse;
        setCurrentUser(data);
        setActiveTab('edit');
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
  };

  const handleAccountDeleted = () => {
    setCurrentUser(null);
    setActiveTab('signin');
  };

  const handleViewPublicProfile = (username: string) => {
    setViewUsername(username);
    setActiveTab('view');
  };

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">
        <div className="flex items-center space-x-3 text-sm">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span>Initializing Dialtone...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      <Navbar
        currentUser={currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={handleLogout}
        viewUsername={viewUsername}
      />

      <main className="flex-1">
        {activeTab === 'signin' && (
          <SignInPage onSuccessRedirect={() => checkAuth()} />
        )}

        {activeTab === 'edit' && currentUser && (
          <ProfileEditPage
            currentUser={currentUser}
            onProfileUpdated={handleProfileUpdated}
            onAccountDeleted={handleAccountDeleted}
            onViewPublicProfile={handleViewPublicProfile}
          />
        )}

        {activeTab === 'edit' && !currentUser && (
          <SignInPage onSuccessRedirect={() => checkAuth()} />
        )}

        {activeTab === 'view' && (
          <ProfileViewPage
            initialUsername={viewUsername || currentUser?.profile.username || ''}
          />
        )}
      </main>

      <footer className="border-t border-zinc-900 py-6 text-center text-xs text-zinc-600">
        DialtoneApp Milestone 1 · Cloudflare Worker + D1 + R2 Foundation
      </footer>
    </div>
  );
}
