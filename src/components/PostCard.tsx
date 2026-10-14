import React, { useState, useEffect } from 'react';
import type { PostItem } from '../../shared/schema.ts';
import { ExpiryChip } from './ExpiryChip.tsx';
import { Heart, MessageSquare, Flag, Trash2, ThumbsUp, ThumbsDown, EyeOff, MoreHorizontal } from 'lucide-react';
import { CommentModal } from './CommentModal.tsx';
import { ReportModal } from './ReportModal.tsx';

interface PostCardProps {
  post: PostItem;
  currentUserId: string;
  onPostDeleted?: (postId: string) => void;
  onViewAuthorProfile?: (username: string) => void;
  onTopicClick?: (topicSlug: string) => void;
}

export const PostCard: React.FC<PostCardProps> = ({
  post,
  currentUserId,
  onPostDeleted,
  onViewAuthorProfile,
  onTopicClick,
}) => {
  const [likesCount, setLikesCount] = useState(post.likes_count);
  const [hasLiked, setHasLiked] = useState(post.has_liked);
  const [commentsCount, setCommentsCount] = useState(post.comments_count);
  const [showComments, setShowComments] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  // Record impression and 3-second dwell signal on mount
  useEffect(() => {
    fetch('/api/impressions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ impressions: [{ post_id: post.id, position: 0 }] }),
    }).catch(() => {});

    const timer = setTimeout(() => {
      fetch('/api/impressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ impressions: [{ post_id: post.id, position: 0, duration_ms: 3000 }] }),
      }).catch(() => {});
    }, 3000);

    return () => clearTimeout(timer);
  }, [post.id]);

  const handleToggleLike = async () => {
    const nextLiked = !hasLiked;
    const nextCount = nextLiked ? likesCount + 1 : Math.max(0, likesCount - 1);

    setHasLiked(nextLiked);
    setLikesCount(nextCount);

    try {
      const method = nextLiked ? 'POST' : 'DELETE';
      const res = await fetch(`/api/posts/${post.id}/likes`, { method });
      if (!res.ok) {
        setHasLiked(!nextLiked);
        setLikesCount(likesCount);
      }
    } catch {
      setHasLiked(!nextLiked);
      setLikesCount(likesCount);
    }
  };

  const handleDeletePost = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/posts/${post.id}`, { method: 'DELETE' });
      if (res.ok) {
        if (onPostDeleted) onPostDeleted(post.id);
      } else {
        setConfirmDelete(false);
        setDeleting(false);
      }
    } catch {
      setConfirmDelete(false);
      setDeleting(false);
    }
  };

  const handleSendFeedback = async (type: 'more_like_this' | 'show_less' | 'not_interested') => {
    setShowMenu(false);
    if (type === 'not_interested') {
      setHidden(true);
    } else {
      setFeedbackNotice(type === 'more_like_this' ? 'Tuned: More like this' : 'Tuned: Showing less');
      setTimeout(() => setFeedbackNotice(null), 3000);
    }

    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: post.id, type }),
      });
    } catch {
      // Ignored
    }
  };

  if (hidden) {
    return (
      <article className="bg-surface border border-border rounded-card p-3 shadow-card text-[13px] text-text-muted flex items-center justify-between">
        <span>Post hidden from your feed.</span>
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="text-primary hover:underline text-[12px] font-semibold cursor-pointer"
        >
          Undo
        </button>
      </article>
    );
  }

  return (
    <article className="bg-surface border border-border rounded-card p-4 shadow-card space-y-3 relative">
      {/* Header: Author + Expiry Chip */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-9 h-9 rounded-sm bg-primary text-on-primary flex items-center justify-center font-semibold text-[14px] shrink-0">
            {post.author_display_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onViewAuthorProfile && onViewAuthorProfile(post.author_username)}
              className="font-semibold text-text text-[14px] hover:underline truncate block text-left cursor-pointer"
            >
              {post.author_display_name}
            </button>
            <div className="flex items-center space-x-1.5 text-[12px] text-text-muted font-mono truncate">
              <span>@{post.author_username}</span>
              {post.author_class_name && (
                <>
                  <span>•</span>
                  <span className="text-primary font-sans font-medium text-[11px] bg-primary-tint px-1.5 py-0.2 rounded-pill">
                    {post.author_class_name}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 flex items-center space-x-2">
          <ExpiryChip expiresAt={post.expires_at} />

          {/* More options menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMenu((prev) => !prev)}
              title="More options"
              aria-label="More options"
              className="p-1 rounded-sm text-text-muted hover:text-text hover:bg-bg transition-colors cursor-pointer"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {showMenu && (
              <div className="absolute right-0 mt-1 w-44 bg-surface border border-border rounded-sm shadow-card z-20 py-1 text-[13px]">
                <button
                  type="button"
                  onClick={() => handleSendFeedback('more_like_this')}
                  className="w-full text-left px-3 py-1.5 hover:bg-bg flex items-center space-x-2 text-text cursor-pointer"
                >
                  <ThumbsUp className="w-3.5 h-3.5 text-primary" />
                  <span>More like this</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSendFeedback('show_less')}
                  className="w-full text-left px-3 py-1.5 hover:bg-bg flex items-center space-x-2 text-text cursor-pointer"
                >
                  <ThumbsDown className="w-3.5 h-3.5 text-text-muted" />
                  <span>Show less like this</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSendFeedback('not_interested')}
                  className="w-full text-left px-3 py-1.5 hover:bg-bg flex items-center space-x-2 text-danger cursor-pointer"
                >
                  <EyeOff className="w-3.5 h-3.5 text-danger" />
                  <span>Not interested</span>
                </button>
                <div className="my-1 border-t border-border" />
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false);
                    setShowReport(true);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-bg flex items-center space-x-2 text-text-muted hover:text-danger cursor-pointer"
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span>Report post</span>
                </button>
              </div>
            )}
          </div>

          {post.author_id === currentUserId && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              title="Delete post"
              aria-label="Delete post"
              className="p-1 rounded-sm text-text-muted hover:text-danger hover:bg-danger-tint transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Delete confirmation inline banner */}
      {confirmDelete && (
        <div className="p-2.5 rounded-sm bg-danger-tint border border-danger text-danger text-[13px] flex items-center justify-between">
          <span>Delete this post permanently?</span>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleDeletePost}
              disabled={deleting}
              className="px-2.5 py-1 rounded-sm bg-danger text-on-primary font-semibold text-[12px] cursor-pointer"
            >
              {deleting ? 'Deleting...' : 'Yes, Delete'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="px-2 py-1 rounded-sm border border-danger text-danger text-[12px] cursor-pointer hover:bg-surface"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Feedback Toast */}
      {feedbackNotice && (
        <div className="text-[12px] font-medium text-primary bg-primary-tint px-2.5 py-1 rounded-sm inline-block">
          {feedbackNotice}
        </div>
      )}

      {/* Post body */}
      <p className="text-[14px] text-text whitespace-pre-wrap leading-relaxed">
        {post.body}
      </p>

      {/* Topics & Hashtags */}
      {post.topics && post.topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {post.topics.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => onTopicClick && onTopicClick(t.slug)}
              className="text-[12px] font-medium px-2 py-0.5 rounded-pill bg-bg hover:bg-primary-tint text-text-muted hover:text-primary border border-border cursor-pointer transition-colors"
            >
              {t.display_name}
            </button>
          ))}
        </div>
      )}

      {/* Media gallery (up to 4 images) */}
      {post.media && post.media.length > 0 && (
        <div
          className={`grid gap-2 rounded-sm overflow-hidden ${
            post.media.length === 1
              ? 'grid-cols-1'
              : 'grid-cols-2'
          }`}
        >
          {post.media.map((img) => (
            <div
              key={img.id}
              className="relative aspect-video bg-bg rounded-sm overflow-hidden border border-border flex items-center justify-center"
            >
              <img
                src={`/api/media/${img.id}`}
                alt="Post media"
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          ))}
        </div>
      )}

      {/* Footer Actions */}
      <div className="pt-2 border-t border-border flex items-center justify-between text-[13px] text-text-muted">
        <div className="flex items-center space-x-4">
          {/* Like Button */}
          <button
            type="button"
            onClick={handleToggleLike}
            className={`flex items-center space-x-1.5 py-1 px-2 rounded-sm transition-colors cursor-pointer ${
              hasLiked ? 'text-danger font-semibold bg-danger-tint' : 'hover:text-text hover:bg-bg'
            }`}
          >
            <Heart className={`w-4 h-4 ${hasLiked ? 'fill-current' : ''}`} />
            <span>{likesCount}</span>
          </button>

          {/* Comments Button */}
          <button
            type="button"
            onClick={() => setShowComments(true)}
            className="flex items-center space-x-1.5 py-1 px-2 rounded-sm hover:text-text hover:bg-bg transition-colors cursor-pointer"
          >
            <MessageSquare className="w-4 h-4" />
            <span>{commentsCount}</span>
          </button>
        </div>

        {/* Report Button */}
        <button
          type="button"
          onClick={() => setShowReport(true)}
          title="Report post"
          aria-label="Report post"
          className="p-1.5 rounded-sm hover:text-danger hover:bg-bg transition-colors cursor-pointer"
        >
          <Flag className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Modals */}
      {showComments && (
        <CommentModal
          postId={post.id}
          currentUserId={currentUserId}
          onClose={() => setShowComments(false)}
          onCommentCountChange={(delta) => setCommentsCount((c) => Math.max(0, c + delta))}
        />
      )}

      {showReport && (
        <ReportModal
          targetType="post"
          targetId={post.id}
          onClose={() => setShowReport(false)}
          onReportSubmitted={() => {
            setFeedbackNotice('Report submitted successfully.');
            setTimeout(() => setFeedbackNotice(null), 3000);
          }}
        />
      )}
    </article>
  );
};
