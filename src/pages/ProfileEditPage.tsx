import React, { useState } from 'react';
import type { MeResponse } from '../../shared/schema.ts';
import { normalizeUsername, isValidUsername } from '../../shared/username.ts';
import { updateProfileSchema } from '../../shared/schema.ts';
import { Save, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';

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

  // Real-time username validation
  const normalizedPreview = normalizeUsername(username);
  const isUsernameValid = isValidUsername(normalizedPreview);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

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
      setMessage({ type: 'success', text: 'Profile updated successfully.' });
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
    <div className="w-full max-w-[640px] mx-auto py-8 px-4 space-y-4">
      {/* Header Info */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-border">
        <div>
          <h1 className="text-[24px] font-semibold text-text tracking-tight">Edit Profile</h1>
          <p className="text-[12px] text-text-muted mt-0.5">
            ID: <span className="font-mono text-text">{currentUser.user.id}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => onViewPublicProfile(currentUser.profile.username)}
          className="min-h-[44px] px-3 rounded-sm border border-border bg-surface text-text hover:bg-primary-tint text-[14px] font-semibold transition-colors cursor-pointer"
        >
          View Profile
        </button>
      </div>

      {/* Inline Feedback Alerts */}
      {message && (
        <div
          className={`p-3 rounded-sm border flex items-start space-x-2 text-[14px] ${
            message.type === 'success'
              ? 'bg-primary-tint border-primary text-primary'
              : 'bg-danger-tint border-danger text-danger'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Main Profile Form Card */}
      <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-card p-4 shadow-card space-y-4">
        {/* Username */}
        <div className="space-y-1">
          <label htmlFor="input-username" className="block text-[12px] font-semibold text-text">
            Username
          </label>
          <input
            id="input-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full min-h-[44px] bg-surface border border-border rounded-sm px-3 py-2 text-[14px] text-text font-mono focus:border-primary transition-colors"
            placeholder="e.g. alice_123"
            minLength={3}
            maxLength={20}
            required
          />
          <div className="flex justify-between items-center text-[12px] pt-0.5">
            <span className="text-text-muted">3–20 lowercase letters, digits, underscores</span>
            {!isUsernameValid && (
              <span className="text-danger font-semibold">Invalid username format</span>
            )}
            {isUsernameValid && (
              <span className="text-text-muted font-mono">@{normalizedPreview}</span>
            )}
          </div>
        </div>

        {/* Display Name */}
        <div className="space-y-1">
          <label htmlFor="input-displayname" className="block text-[12px] font-semibold text-text">
            Display Name
          </label>
          <input
            id="input-displayname"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full min-h-[44px] bg-surface border border-border rounded-sm px-3 py-2 text-[14px] text-text focus:border-primary transition-colors"
            placeholder="e.g. Alice Wonderland"
            maxLength={50}
            required
          />
          <p className="text-[12px] text-text-muted">1–50 characters</p>
        </div>

        {/* Biography */}
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <label htmlFor="input-bio" className="block text-[12px] font-semibold text-text">
              Biography
            </label>
            <span className="text-[12px] text-text-muted">{bio.length} / 500</span>
          </div>
          <textarea
            id="input-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={500}
            className="w-full bg-surface border border-border rounded-sm p-3 text-[14px] text-text focus:border-primary resize-none transition-colors"
            placeholder="Tell others about yourself..."
          />
        </div>

        {/* DM Policy */}
        <div className="space-y-1">
          <label htmlFor="select-dmpolicy" className="block text-[12px] font-semibold text-text">
            Direct Message Policy
          </label>
          <select
            id="select-dmpolicy"
            value={dmPolicy}
            onChange={(e) => setDmPolicy(e.target.value)}
            className="w-full min-h-[44px] bg-surface border border-border rounded-sm px-3 py-2 text-[14px] text-text focus:border-primary transition-colors cursor-pointer"
          >
            <option value="everyone">Everyone can message</option>
            <option value="following">Only users I follow</option>
            <option value="none">No one</option>
          </select>
        </div>

        {/* The ONE Primary Blue Button on Screen */}
        <button
          type="submit"
          disabled={saving || !isUsernameValid}
          className="w-full min-h-[44px] px-4 rounded-sm bg-primary hover:bg-primary-hover text-on-primary font-semibold text-[14px] flex items-center justify-center space-x-2 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving...' : 'Save Profile'}</span>
        </button>
      </form>

      {/* Danger Zone Card */}
      <div className="bg-surface border border-border rounded-card p-4 shadow-card space-y-2">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-pill bg-danger inline-block" />
          <h2 className="text-[14px] font-semibold text-danger">Delete Account</h2>
        </div>
        <p className="text-[12px] text-text-muted leading-relaxed">
          Permanently removes your account, profile, settings, and sessions from the database. This action cannot be reversed.
        </p>
        <button
          type="button"
          onClick={() => setShowDeleteModal(true)}
          className="min-h-[44px] px-4 rounded-sm border border-danger text-danger bg-surface hover:bg-danger-tint text-[14px] font-semibold flex items-center space-x-2 transition-colors cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
          <span>Delete Account</span>
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-[#17233A]/40 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-card p-4 max-w-[420px] w-full space-y-4 shadow-card">
            <h3 className="text-[16px] font-semibold text-danger flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5" />
              <span>Confirm Account Deletion</span>
            </h3>
            <p className="text-[14px] text-text">
              Type <strong className="font-mono text-text">DELETE</strong> below to confirm permanent removal.
            </p>
            <div>
              <label htmlFor="confirm-delete-input" className="block text-[12px] font-semibold text-text mb-1">
                Confirmation Text
              </label>
              <input
                id="confirm-delete-input"
                type="text"
                value={deleteConfirmationText}
                onChange={(e) => setDeleteConfirmationText(e.target.value)}
                placeholder="Type DELETE"
                className="w-full min-h-[44px] bg-surface border border-border rounded-sm px-3 py-2 text-[14px] font-mono text-text focus:border-danger"
              />
            </div>
            <div className="flex space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 min-h-[44px] px-3 rounded-sm border border-border bg-surface text-text hover:bg-bg text-[14px] font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteConfirmationText !== 'DELETE' || deleting}
                className="flex-1 min-h-[44px] px-3 rounded-sm bg-danger hover:opacity-90 disabled:opacity-40 text-on-primary text-[14px] font-semibold transition-colors cursor-pointer"
              >
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
