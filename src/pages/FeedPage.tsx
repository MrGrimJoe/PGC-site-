import React, { useState, useEffect } from 'react';
import type { PostItem, FeedResponse, TrendItem } from '../../shared/schema.ts';
import { PostCard } from '../components/PostCard.tsx';
import { RefreshCw, PlusCircle, AlertCircle, Sparkles, Search, TrendingUp, X } from 'lucide-react';

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
  const [feedMode, setFeedMode] = useState<'for_you' | 'following'>('for_you');
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningJob, setRunningJob] = useState(false);
  const [jobNotice, setJobNotice] = useState<string | null>(null);

  // Search & Trending
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [searching, setSearching] = useState(false);

  // Load trends
  useEffect(() => {
    fetch('/api/trends?window=24h')
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { trends?: TrendItem[] };
        setTrends(data.trends || []);
      })
      .catch(() => {});
  }, []);

  const fetchFeed = async (cursor?: string, currentSearch = activeSearch) => {
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      let url: string;
      if (currentSearch.trim()) {
        url = `/api/search?q=${encodeURIComponent(currentSearch.trim())}&limit=20`;
      } else {
        const modeParam = feedMode === 'for_you' ? 'mode=for_you' : 'mode=following';
        url = cursor
          ? `/api/feed?${modeParam}&cursor=${encodeURIComponent(cursor)}&limit=10`
          : `/api/feed?${modeParam}&limit=10`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || 'Failed to load posts');
      }

      const data = (await res.json()) as FeedResponse & { posts: PostItem[] };
      if (cursor) {
        setPosts((prev) => [...prev, ...data.posts]);
      } else {
        setPosts(data.posts || []);
      }
      setNextCursor(data.next_cursor || null);
      setHasMore(!!data.has_more);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setSearching(false);
    }
  };

  useEffect(() => {
    fetchFeed();
  }, [feedMode, activeSearch]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearching(true);
    setActiveSearch(searchQuery);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setActiveSearch('');
  };

  const handleTrendClick = (slug: string) => {
    setSearchQuery(slug);
    setActiveSearch(slug);
  };

  const handlePostDeleted = (deletedId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== deletedId));
  };

  // DEV-ONLY: remove before launch
  const handleTriggerExpiryJob = async () => {
    setRunningJob(true);
    setJobNotice(null);
    try {
      const res = await fetch('/api/jobs/cleanup-expired', { method: 'POST' });
      if (res.ok) {
        const result = (await res.json()) as { checked: number; extended: number; deleted: number; prunedOrphanMedia: number };
        setJobNotice(`Expiry job completed: checked ${result.checked}, extended ${result.extended}, deleted ${result.deleted}, cleaned ${result.prunedOrphanMedia} orphan media.`);
        setTimeout(() => setJobNotice(null), 5000);
        fetchFeed();
      }
    } catch (err) {
      setJobNotice(`Job error: ${(err as Error).message}`);
    } finally {
      setRunningJob(false);
    }
  };

  return (
    <div className="w-full max-w-[640px] mx-auto py-6 px-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h1 className="text-[24px] font-semibold text-text tracking-tight">Timeline</h1>
          <p className="text-[13px] text-text-muted mt-0.5">
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
            disabled={loading || searching}
            title="Refresh feed"
            aria-label="Refresh feed"
            className="min-h-[44px] min-w-[44px] p-2.5 rounded-sm border border-border bg-surface text-text hover:bg-bg flex items-center justify-center cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* DEV notice */}
      {jobNotice && (
        <div className="p-2.5 rounded-sm bg-primary-tint text-primary text-[13px] font-medium border border-border">
          {jobNotice}
        </div>
      )}

      {/* Search Input Bar */}
      <form onSubmit={handleSearchSubmit} className="relative">
        <label htmlFor="search-input" className="sr-only">Search timeline</label>
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-text-muted absolute left-3 pointer-events-none" />
          <input
            id="search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search keywords or #topics..."
            className="w-full min-h-[44px] pl-9 pr-10 py-2 rounded-sm border border-border bg-surface text-text text-[14px] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              title="Clear search"
              className="absolute right-3 p-1 text-text-muted hover:text-text cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </form>

      {/* Trending Topics Chips */}
      {trends.length > 0 && !activeSearch && (
        <div className="flex items-center space-x-2 overflow-x-auto py-1 scrollbar-none">
          <div className="flex items-center space-x-1 text-text-muted text-[12px] shrink-0 font-medium">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <span>Trending:</span>
          </div>
          {trends.slice(0, 5).map((tr) => (
            <button
              key={tr.slug}
              type="button"
              onClick={() => handleTrendClick(tr.slug)}
              className="shrink-0 text-[12px] font-medium px-2.5 py-1 rounded-pill bg-surface hover:bg-primary-tint text-text border border-border cursor-pointer transition-colors"
            >
              #{tr.slug}
            </button>
          ))}
        </div>
      )}

      {/* Feed Mode Tabs (For You vs Following) */}
      {!activeSearch && (
        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => setFeedMode('for_you')}
            className={`flex-1 min-h-[44px] pb-2 text-[14px] font-semibold text-center transition-colors cursor-pointer border-b-2 ${
              feedMode === 'for_you'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            For You (Ranked)
          </button>
          <button
            type="button"
            onClick={() => setFeedMode('following')}
            className={`flex-1 min-h-[44px] pb-2 text-[14px] font-semibold text-center transition-colors cursor-pointer border-b-2 ${
              feedMode === 'following'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            Following
          </button>
        </div>
      )}

      {activeSearch && (
        <div className="flex items-center justify-between text-[13px] text-text-muted bg-surface p-2.5 rounded-sm border border-border">
          <span>
            Search results for &ldquo;<strong>{activeSearch}</strong>&rdquo;
          </span>
          <button
            type="button"
            onClick={handleClearSearch}
            className="text-primary hover:underline font-semibold cursor-pointer"
          >
            Back to Feed
          </button>
        </div>
      )}

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
          <p>Loading posts...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && posts.length === 0 && !error && (
        <div className="text-center py-12 border border-dashed border-border rounded-card bg-surface text-text-muted space-y-3">
          <p className="font-semibold text-text text-[16px]">
            {activeSearch ? 'No posts matched your search' : 'Your feed is empty'}
          </p>
          <p className="text-[14px] max-w-[360px] mx-auto text-text-muted">
            {activeSearch
              ? 'Try searching for other keywords or explore trending hashtags above.'
              : 'Follow classmates or post your thoughts to start shaping your discovery feed.'}
          </p>
          {!activeSearch && (
            <button
              type="button"
              onClick={onNavigateToCompose}
              className="min-h-[44px] px-4 rounded-sm bg-primary hover:bg-primary-hover text-on-primary font-semibold text-[14px] inline-flex items-center space-x-1.5 cursor-pointer transition-colors"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Create a Post</span>
            </button>
          )}
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
              onTopicClick={(slug) => {
                setSearchQuery(slug);
                setActiveSearch(slug);
              }}
            />
          ))}

          {/* Pagination: Load more button */}
          {hasMore && !activeSearch && (
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
