import React, { useState, useEffect } from 'react';
import type { PublicProfileResponse } from '../../shared/schema.ts';
import { Search, User, Calendar, Shield, AlertCircle } from 'lucide-react';

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
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      {/* Header and Lookup Bar */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Public Profile Directory</h1>
        <p className="text-xs text-zinc-400 mt-1">
          Look up any registered member via <code className="text-zinc-300">GET /api/users/:username</code>
        </p>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchUsername}
            onChange={(e) => setSearchUsername(e.target.value)}
            placeholder="Search by username (e.g. alice, bob)..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !searchUsername.trim()}
          className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition disabled:opacity-50 cursor-pointer"
        >
          {loading ? 'Searching...' : 'Find Profile'}
        </button>
      </form>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-900/50 flex items-start space-x-3 text-sm text-amber-200">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{error}</p>
            <p className="text-xs text-amber-300/80 mt-1">
              Verify the username spelling or register the account first.
            </p>
          </div>
        </div>
      )}

      {/* Profile Card */}
      {profile && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
          <div className="flex items-start space-x-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center text-white font-bold text-2xl shadow-lg shadow-cyan-500/10 shrink-0">
              {profile.display_name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-zinc-100 truncate">{profile.display_name}</h2>
              <p className="text-sm text-cyan-400 font-mono">@{profile.username}</p>
              <div className="flex items-center space-x-1.5 text-xs text-zinc-400 mt-2">
                <Calendar className="w-3.5 h-3.5 text-zinc-500" />
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

          {/* Bio */}
          <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-4">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
              About
            </span>
            <p className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
              {profile.bio || <span className="italic text-zinc-500">No biography provided yet.</span>}
            </p>
          </div>

          {/* Privacy Note */}
          <div className="border-t border-zinc-800 pt-4 flex items-center space-x-2 text-xs text-zinc-500">
            <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Public profile fields only: username, display_name, bio, avatar_media_id, created_at. Provider IDs and settings remain protected.
            </span>
          </div>
        </div>
      )}

      {!profile && !error && !loading && (
        <div className="text-center py-12 border border-dashed border-zinc-800 rounded-2xl text-zinc-500 text-sm">
          <User className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
          <p>Enter a username above to inspect their public profile.</p>
        </div>
      )}
    </div>
  );
};
