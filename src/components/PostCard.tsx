import React, { useState } from 'react';
import type { PostItem } from '../../shared/schema.ts';
import { ExpiryChip } from './ExpiryChip.tsx';
import { Heart, MessageSquare, Flag, Trash2 } from 'lucide-react';
import { CommentModal } from './CommentModal.tsx';
import { ReportModal } from './ReportModal.tsx';

interface PostCardProps {
  post: PostItem;
  currentUserId: string;
  onPostDeleted?: (postId: string) => void;
  onViewAuthorProfile?: (username: string) => void;
}

export const PostCard: React.FC<PostCardProps> = ({
  post,
  currentUserId,
  onPostDeleted,
  onViewAuthorProfile,
}) => {
  const [likesCount, setLikesCount] = useState(post.likes_count);
  const [hasLiked, setHasLiked] = useState(post.has_liked);
  const [commentsCount, setCommentsCount] = useState(post.comments_count);
  const [showComments, setShowComments] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleToggleLike = async () => {
    const nextLiked = !hasLiked;
    const nextCount = nextLiked ? likesCount + 1 : Math.max(0, likesCount - 1);

    // Optimistic UI update
    setHasLiked(nextLiked);
    setLikesCount(nextCount);

    try {
      const method = nextLiked ? 'POST' : 'DELETE';
      const res = await fetch(`/api/posts/${post.id}/likes`, { method });
      if (!res.ok) {
        // Rollback on failure
        setHasLiked(!nextLiked);
        setLikesCount(likesCount);
      }
    } catch {
      setHasLiked(!nextLiked);
      setLikesCount(likesCount);
    }
  };

  const handleDeletePost = async () => {
    if (!window.confirm('Are you sure you want to delete this post?')) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/posts/${post.id}`, { method: 'DELETE' });
      if (res.ok) {
        if (onPostDeleted) onPostDeleted(post.id);
      } else {
        alert('Failed to delete post');
        setDeleting(false);
      }
    } catch {
      alert('Network error deleting post');
      setDeleting(false);
    }
  };

  return (
    <article className="bg-surface border border-border rounded-card p-4 shadow-card space-y-3">
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
            <span className="text-[12px] text-text-muted font-mono block truncate">
              @{post.author_username}
            </span>
          </div>
        </div>

        <div className="shrink-0 flex items-center space-x-2">
          <ExpiryChip expiresAt={post.expires_at} />
          {post.author_id === currentUserId && (
            <button
              type="button"
              onClick={handleDeletePost}
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

      {/* Post body */}
      <p className="text-[14px] text-text whitespace-pre-wrap leading-relaxed">
        {post.body}
      </p>

      {/* Media gallery (up to 4 images) */}
      {post.media && post.media.length > 0 && (
        <div
          className={`grid gap-2 rounded-sm overflow-hidden ${
            post.media.length === 1
              ? 'grid-cols-1'
              : post.media.length === 2
              ? 'grid-cols-2'
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
          onReportSubmitted={() => alert('Report submitted successfully. Thank you.')}
        />
      )}
    </article>
  );
};
