import React, { useState, useEffect } from 'react';
import type { PublicProfileResponse } from '../../shared/schema.ts';
import { Search, User, Calendar, AlertCircle } from 'lucide-react';

interface ProfileViewPageProps {
  initialUsername?: string;
}

export const ProfileViewPage: React.FC<ProfileViewPageProps> = ({ initialUsername = '' }) => {
  const [searchUsername, setSearchUsername] = useState(initialUsername || '');
  const [profile, setProfile] = useState<PublicProfileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async (u: string) => {
    if (!u.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(u.trim())}`);
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Please sign in to search and view user profiles.');
        }
        if (res.status === 404) {
          throw new Error(`User "@${u.trim()}" not found.`);
        }
        throw new Error(`Failed to load profile (status ${res.status})`);
      }
      const data = (await res.json()) as PublicProfileResponse;
      setProfile(data);
    } catch (err) {
      setProfile(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialUsername) {
      setSearchUsername(initialUsername);
      fetchProfile(initialUsername);
    }
  }, [initialUsername]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchProfile(searchUsername);
  };

  return (
    <div className="w-full max-w-[640px] mx-auto py-8 px-4 space-y-4">
      {/* Title */}
      <div>
        <h1 className="text-[24px] font-semibold text-text tracking-tight">User Directory</h1>
        <p className="text-[14px] text-text-muted mt-0.5">
          Look up public profiles across the network
        </p>
      </div>

      {/* Search Card */}
      <form onSubmit={handleSearchSubmit} className="bg-surface border border-border rounded-card p-4 shadow-card space-y-3">
        <div className="space-y-1">
          <label htmlFor="search-username-input" className="block text-[12px] font-semibold text-text">
            Search by Username
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="search-username-input"
                type="text"
                value={searchUsername}
                onChange={(e) => setSearchUsername(e.target.value)}
                placeholder="e.g. alice_123"
                className="w-full min-h-[44px] bg-surface border border-border rounded-sm pl-9 pr-3 py-2 text-[14px] text-text font-mono focus:border-primary transition-colors"
              />
            </div>
            {/* The ONE Primary Blue Button on Screen */}
            <button
              type="submit"
              disabled={loading || !searchUsername.trim()}
              className="min-h-[44px] px-4 rounded-sm bg-primary hover:bg-primary-hover text-on-primary text-[14px] font-semibold flex items-center justify-center transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      </form>

      {/* Inline Error State */}
      {error && (
        <div className="p-3 rounded-sm border border-danger bg-danger-tint text-danger flex items-start space-x-2 text-[14px]">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Profile Card */}
      {profile && (
        <div className="bg-surface border border-border rounded-card p-4 shadow-card space-y-4">
          <div className="flex items-start space-x-3">
            <div className="w-12 h-12 rounded-sm bg-primary text-on-primary flex items-center justify-center font-semibold text-[20px] shrink-0">
              {profile.display_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[20px] font-semibold text-text truncate">{profile.display_name}</h2>
              <p className="text-[14px] text-text-muted font-mono">@{profile.username}</p>
              <div className="flex items-center space-x-1.5 text-[12px] text-text-muted mt-1">
                <Calendar className="w-3.5 h-3.5" />
                <span>
                  Member since {new Date(profile.created_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            </div>
          </div>

          {/* About Section */}
          <div className="border border-border rounded-sm p-3 bg-bg">
            <span className="text-[12px] font-semibold text-text block mb-1">
              About
            </span>
            <p className="text-[14px] text-text whitespace-pre-wrap leading-relaxed">
              {profile.bio || <span className="text-text-muted italic">No biography provided.</span>}
            </p>
          </div>
        </div>
      )}

      {/* Clear Empty State */}
      {!profile && !error && !loading && (
        <div className="text-center py-10 border border-dashed border-border rounded-card bg-surface text-text-muted text-[14px] space-y-1">
          <User className="w-7 h-7 mx-auto mb-1 text-text-muted" />
          <p className="font-semibold text-text">No profile selected</p>
          <p className="text-[12px]">Enter a username above to inspect their profile.</p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="text-center py-10 border border-border rounded-card bg-surface text-text-muted text-[14px]">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-pill animate-spin mx-auto mb-2" />
          <p>Loading profile...</p>
        </div>
      )}
    </div>
  );
};
