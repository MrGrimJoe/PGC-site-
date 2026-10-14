import React, { useState } from 'react';
import type { MediaItem } from '../../shared/schema.ts';
import { Image, X, Send, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface PostComposerPageProps {
  onPostCreated: () => void;
}

export const PostComposerPage: React.FC<PostComposerPageProps> = ({ onPostCreated }) => {
  const [body, setBody] = useState('');
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (mediaList.length + files.length > 4) {
      setMessage({ type: 'error', text: 'You can upload a maximum of 4 images per post.' });
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;

        // Validate size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
          throw new Error(`"${file.name}" exceeds 5 MB limit.`);
        }

        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/media/uploads', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const errData = (await res.json()) as { error?: string };
          throw new Error(errData.error || `Upload failed for "${file.name}"`);
        }

        const mediaItem = (await res.json()) as MediaItem;
        setMediaList((prev) => [...prev, mediaItem]);
      }
    } catch (err) {
      setMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleRemoveMedia = (mediaId: string) => {
    setMediaList((prev) => prev.filter((m) => m.id !== mediaId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;

    setSubmitting(true);
    setMessage(null);

    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: body.trim(),
          media_ids: mediaList.map((m) => m.id),
        }),
      });

      if (!res.ok) {
        const errData = (await res.json()) as { error?: string };
        throw new Error(errData.error || 'Failed to publish post');
      }

      setBody('');
      setMediaList([]);
      setMessage({ type: 'success', text: 'Post published! Initial 7-day timer started.' });
      setTimeout(() => {
        onPostCreated();
      }, 1000);
    } catch (err) {
      setMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-[640px] mx-auto py-8 px-4 space-y-4">
      <div>
        <h1 className="text-[24px] font-semibold text-text tracking-tight">Create Post</h1>
        <p className="text-[14px] text-text-muted mt-0.5">
          Posts expire in 7 days unless extended by 3+ community reactions.
        </p>
      </div>

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

      <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-card p-4 shadow-card space-y-4">
        {/* Post Text Area */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="post-body-input" className="block text-[12px] font-semibold text-text">
              What's on your mind?
            </label>
            <span className="text-[12px] text-text-muted">{body.length} / 1000</span>
          </div>
          <textarea
            id="post-body-input"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Share thoughts, news, or questions... Use #hashtags to categorize for discovery."
            maxLength={1000}
            required
            className="w-full bg-surface border border-border rounded-sm p-3 text-[14px] text-text focus:border-primary resize-none transition-colors"
          />
        </div>

        {/* Detected Topics & Hashtags */}
        {body.includes('#') && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[12px] text-text-muted font-medium">Tags:</span>
            {Array.from(new Set(body.match(/#([a-zA-Z0-9_]{1,30})/g) || [])).slice(0, 5).map((tag) => (
              <span key={tag} className="text-[12px] font-medium px-2 py-0.5 rounded-pill bg-primary-tint text-primary font-mono">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Media Attachments Preview */}
        {mediaList.length > 0 && (
          <div className="space-y-1">
            <span className="text-[12px] font-semibold text-text block">
              Attached Media ({mediaList.length}/4)
            </span>
            <div className="grid grid-cols-2 gap-2">
              {mediaList.map((m) => (
                <div
                  key={m.id}
                  className="relative aspect-video rounded-sm overflow-hidden border border-border bg-bg group"
                >
                  <img
                    src={`/api/media/${m.id}`}
                    alt="Upload thumbnail"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveMedia(m.id)}
                    className="absolute top-1.5 right-1.5 p-1 rounded-sm bg-[#17233A]/80 text-white hover:bg-danger transition-colors cursor-pointer"
                    title="Remove image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Attach Media Picker */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div>
            <label
              htmlFor="media-file-input"
              className={`inline-flex items-center space-x-1.5 px-3 py-2 rounded-sm border border-border bg-surface text-text hover:bg-bg text-[13px] font-semibold cursor-pointer transition-colors ${
                mediaList.length >= 4 || uploading ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              <Image className="w-4 h-4 text-text-muted" />
              <span>{uploading ? 'Uploading...' : 'Add Images (Max 4)'}</span>
            </label>
            <input
              id="media-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* ONE Primary Blue Button on screen */}
          <button
            type="submit"
            disabled={submitting || !body.trim() || uploading}
            className="min-h-[44px] px-5 rounded-sm bg-primary hover:bg-primary-hover disabled:opacity-50 text-on-primary font-semibold text-[14px] flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>{submitting ? 'Publishing...' : 'Publish Post'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
