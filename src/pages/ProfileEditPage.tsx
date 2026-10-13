import React, { useState } from 'react';
import type { MeResponse } from '../../shared/schema.ts';
import { normalizeUsername, isValidUsername } from '../../shared/username.ts';
import { updateProfileSchema } from '../../shared/schema.ts';
import { Save, AlertCircle, CheckCircle, Trash2, ShieldAlert, User, AtSign, Settings } from 'lucide-react';

interface ProfileEditPageProps {
  currentUser: MeResponse;
  onProfileUpdated: (updated: MeResponse) => void;
  onAccountDeleted: () => void;
  onViewPublicProfile: (username: string) => void;
}

export const ProfileEditPage: React.FC<ProfileEditPageProps> = ({
  currentUser,
  onProfileUpdated,
  onAccountDeleted,
  onViewPublicProfile,
}) => {
  const [username, setUsername] = useState(currentUser.profile.username);
  const [displayName, setDisplayName] = useState(currentUser.profile.display_name);
  const [bio, setBio] = useState(currentUser.profile.bio || '');
  const [dmPolicy, setDmPolicy] = useState(currentUser.settings.dm_policy || 'everyone');

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Deletion modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Real-time username normalization and validation check
  const normalizedPreview = normalizeUsername(username);
  const isUsernameValid = isValidUsername(normalizedPreview);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    // Validate using shared zod schema
    const payload = {
      username: normalizedPreview !== currentUser.profile.username ? normalizedPreview : undefined,
      display_name: displayName,
      bio: bio,
      dm_policy: dmPolicy as 'everyone' | 'following' | 'none',
    };

    const parsed = updateProfileSchema.safeParse(payload);
    if (!parsed.success) {
      setMessage({
        type: 'error',
        text: parsed.error.issues[0]?.message || 'Invalid input data',
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as MeResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update profile');
      }

      onProfileUpdated(data);
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
    } catch (err) {
      setMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmationText !== 'DELETE') {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch('/api/me', {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || 'Failed to delete account');
      }

      onAccountDeleted();
    } catch (err) {
      alert((err as Error).message);
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-8">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Edit Profile & Settings</h1>
          <p className="text-xs text-zinc-400 mt-1 font-mono">
            User ID: <span className="text-zinc-300">{currentUser.user.id}</span> · Status:{' '}
            <span className="text-emerald-400 capitalize">{currentUser.user.status}</span>
          </p>
        </div>
        <button
          onClick={() => onViewPublicProfile(currentUser.profile.username)}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition flex items-center space-x-1.5 self-start cursor-pointer"
        >
          <span>View Public Profile</span>
        </button>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl flex items-start space-x-3 text-sm ${
            message.type === 'success'
              ? 'bg-emerald-950/40 border border-emerald-800/60 text-emerald-200'
              : 'bg-red-950/40 border border-red-800/60 text-red-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Main Profile Form */}
      <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-6">
        {/* Username */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center space-x-1.5">
            <AtSign className="w-3.5 h-3.5 text-indigo-400" />
            <span>Username</span>
          </label>
          <div className="relative">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-indigo-500 font-mono"
              placeholder="e.g. alice_123"
              minLength={3}
              maxLength={20}
              required
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">
              3-20 characters, lowercase letters, digits, underscores only.
            </span>
            <span
              className={`font-mono ${
                isUsernameValid ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {isUsernameValid ? `Valid: @${normalizedPreview}` : 'Invalid format'}
            </span>
          </div>
        </div>

        {/* Display Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center space-x-1.5">
            <User className="w-3.5 h-3.5 text-emerald-400" />
            <span>Display Name</span>
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-emerald-500"
            placeholder="e.g. Alice Wonderland"
            maxLength={50}
            required
          />
          <p className="text-xs text-zinc-400">Public name displayed on your profile (1-50 chars).</p>
        </div>

        {/* Bio */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              Biography
            </label>
            <span className="text-xs text-zinc-400">{bio.length} / 500</span>
          </div>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={500}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-cyan-500 resize-none"
            placeholder="Tell the community about yourself..."
          />
        </div>

        {/* Settings: DM Policy */}
        <div className="pt-2 border-t border-zinc-800 space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center space-x-1.5">
            <Settings className="w-3.5 h-3.5 text-purple-400" />
            <span>Direct Message Policy (Settings)</span>
          </label>
          <select
            value={dmPolicy}
            onChange={(e) => setDmPolicy(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-purple-500"
          >
            <option value="everyone">Everyone can message</option>
            <option value="following">Only users I follow</option>
            <option value="none">No one</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={saving || !isUsernameValid}
          className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition shadow-md shadow-indigo-600/20 disabled:opacity-50 cursor-pointer"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving Changes...' : 'Save Profile (PATCH /api/me)'}</span>
        </button>
      </form>

      {/* Danger Zone: Account Deletion */}
      <div className="bg-red-950/20 border border-red-900/40 rounded-2xl p-6 space-y-4">
        <div className="flex items-center space-x-2 text-red-400 font-semibold text-sm">
          <ShieldAlert className="w-5 h-5 text-red-400" />
          <span>Danger Zone: Account Deletion</span>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Deleting your account executes <code className="text-red-300">DELETE /api/me</code>. This permanently removes your user record, profile, settings, and active sessions from Cloudflare D1. This action is irreversible.
        </p>
        <button
          type="button"
          onClick={() => setShowDeleteModal(true)}
          className="px-4 py-2 rounded-xl bg-red-950 hover:bg-red-900/80 text-red-300 border border-red-800/80 text-xs font-semibold transition flex items-center space-x-2 cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
          <span>Delete My Account</span>
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-red-900/60 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-red-400 flex items-center space-x-2">
              <ShieldAlert className="w-5 h-5" />
              <span>Confirm Account Deletion</span>
            </h3>
            <p className="text-xs text-zinc-300">
              Type <strong className="text-white font-mono">DELETE</strong> below to permanently delete your account and all associated D1 database records.
            </p>
            <input
              type="text"
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              placeholder="Type DELETE to confirm"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:border-red-500"
            />
            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteConfirmationText !== 'DELETE' || deleting}
                className="flex-1 py-2 px-3 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-semibold transition cursor-pointer"
              >
                {deleting ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
