import React, { useState, useEffect } from 'react';
import type { PostItem, FeedResponse } from '../../shared/schema.ts';
import { PostCard } from '../components/PostCard.tsx';
import { RefreshCw, PlusCircle, AlertCircle, Sparkles } from 'lucide-react';

interface FeedPageProps {
  currentUserId: string;
  onNavigateToCompose: () => void;
  onViewAuthorProfile: (username: string) => void;
}

export const FeedPage: React.FC<FeedPageProps> = ({
  currentUserId,
  onNavigateToCompose,
  onViewAuthorProfile,
}) => {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningJob, setRunningJob] = useState(false);

  const fetchFeed = async (cursor?: string) => {
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const url = cursor
        ? `/api/feed?cursor=${encodeURIComponent(cursor)}&limit=10`
        : '/api/feed?limit=10';
      const res = await fetch(url);

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || 'Failed to load feed');
      }

      const data = (await res.json()) as FeedResponse;
      if (cursor) {
        setPosts((prev) => [...prev, ...data.posts]);
      } else {
        setPosts(data.posts || []);
      }
      setNextCursor(data.next_cursor);
      setHasMore(data.has_more);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchFeed();
  }, []);

  const handlePostDeleted = (deletedId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== deletedId));
  };

  // DEV-ONLY: remove before launch
  const handleTriggerExpiryJob = async () => {
    setRunningJob(true);
    try {
      const res = await fetch('/api/jobs/cleanup-expired', { method: 'POST' });
      if (res.ok) {
        const result = (await res.json()) as { checked: number; extended: number; deleted: number };
        alert(`Expiry Job Executed!\nChecked: ${result.checked}\nExtended: ${result.extended}\nDeleted: ${result.deleted}`);
        fetchFeed();
      }
    } catch (err) {
      alert(`Job failed: ${(err as Error).message}`);
    } finally {
      setRunningJob(false);
    }
  };

  return (
    <div className="w-full max-w-[640px] mx-auto py-8 px-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h1 className="text-[24px] font-semibold text-text tracking-tight">Timeline</h1>
          <p className="text-[14px] text-text-muted mt-0.5">
            Ephemerality by default: posts vanish after 7 days without engagement.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* DEV-ONLY: remove before launch */}
          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={handleTriggerExpiryJob}
              disabled={runningJob}
              title="Run daily post expiry lifecycle job manually"
              className="min-h-[44px] px-2.5 py-1.5 rounded-sm border border-border bg-surface text-text-muted hover:text-text hover:bg-bg text-[12px] font-semibold flex items-center space-x-1 cursor-pointer transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              <span>{runningJob ? 'Running...' : 'Run Expiry'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => fetchFeed()}
            disabled={loading}
            title="Refresh feed"
            aria-label="Refresh feed"
            className="min-h-[44px] min-w-[44px] p-2.5 rounded-sm border border-border bg-surface text-text hover:bg-bg flex items-center justify-center cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-3 rounded-sm border border-danger bg-danger-tint text-danger flex items-start space-x-2 text-[14px]">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-center py-12 border border-border rounded-card bg-surface text-text-muted text-[14px]">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-pill animate-spin mx-auto mb-2" />
          <p>Loading your feed...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && posts.length === 0 && !error && (
        <div className="text-center py-12 border border-dashed border-border rounded-card bg-surface text-text-muted space-y-3">
          <p className="font-semibold text-text text-[16px]">Your feed is empty</p>
          <p className="text-[14px] max-w-[360px] mx-auto text-text-muted">
            Follow other members or publish your first ephemeral post to get started!
          </p>
          <button
            type="button"
            onClick={onNavigateToCompose}
            className="min-h-[44px] px-4 rounded-sm bg-primary hover:bg-primary-hover text-on-primary font-semibold text-[14px] inline-flex items-center space-x-1.5 cursor-pointer transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create a Post</span>
          </button>
        </div>
      )}

      {/* Post feed */}
      {!loading && posts.length > 0 && (
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              onPostDeleted={handlePostDeleted}
              onViewAuthorProfile={onViewAuthorProfile}
            />
          ))}

          {/* Pagination: Load more button */}
          {hasMore && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => nextCursor && fetchFeed(nextCursor)}
                disabled={loadingMore}
                className="min-h-[44px] px-5 rounded-sm border border-border bg-surface text-text hover:bg-primary-tint font-semibold text-[14px] transition-colors cursor-pointer"
              >
                {loadingMore ? 'Loading older posts...' : 'Load Older Posts'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
