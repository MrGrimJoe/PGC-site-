import React, { useState, useEffect } from 'react';
import type { CommentItem, CommentsResponse } from '../../shared/schema.ts';
import { MessageSquare, X, Send, Trash2 } from 'lucide-react';

interface CommentModalProps {
  postId: string;
  currentUserId: string;
  onClose: () => void;
  onCommentCountChange?: (delta: number) => void;
}

export const CommentModal: React.FC<CommentModalProps> = ({
  postId,
  currentUserId,
  onClose,
  onCommentCountChange,
}) => {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchComments = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`);
      if (res.ok) {
        const data = (await res.json()) as CommentsResponse;
        setComments(data.comments || []);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();
  }, [postId]);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentText.trim() }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || 'Failed to add comment');
      }

      const newComment = (await res.json()) as CommentItem;
      setComments((prev) => [...prev, newComment]);
      setCommentText('');
      if (onCommentCountChange) onCommentCountChange(1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      const res = await fetch(`/api/comments/${commentId}`, { method: 'DELETE' });
      if (res.ok) {
        setComments((prev) => prev.filter((c) => c.id !== commentId));
        if (onCommentCountChange) onCommentCountChange(-1);
      }
    } catch {
      // Ignore deletion network error
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#17233A]/40 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-card p-4 max-w-[500px] w-full max-h-[85vh] flex flex-col shadow-card">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center space-x-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h3 className="text-[16px] font-semibold text-text">Comments</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-sm text-text-muted hover:text-text hover:bg-bg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="my-2 p-2 rounded-sm bg-danger-tint border border-danger text-danger text-[12px]">
            {error}
          </div>
        )}

        {/* Comment list */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3">
          {loading && (
            <div className="text-center py-6 text-text-muted text-[14px]">
              Loading comments...
            </div>
          )}

          {!loading && comments.length === 0 && (
            <div className="text-center py-8 text-text-muted text-[14px]">
              No comments yet. Start the conversation!
            </div>
          )}

          {!loading &&
            comments.map((comment) => (
              <div
                key={comment.id}
                className="p-3 rounded-sm bg-bg border border-border space-y-1 text-[14px]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-semibold text-text">{comment.author_display_name}</span>
                    <span className="text-[12px] text-text-muted font-mono">
                      @{comment.author_username}
                    </span>
                  </div>
                  {comment.author_id === currentUserId && (
                    <button
                      type="button"
                      onClick={() => handleDeleteComment(comment.id)}
                      className="text-text-muted hover:text-danger p-1 rounded-sm cursor-pointer"
                      title="Delete comment"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-text whitespace-pre-wrap">{comment.body}</p>
                <span className="text-[11px] text-text-muted block pt-0.5">
                  {new Date(comment.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
        </div>

        {/* Input box */}
        <form onSubmit={handleAddComment} className="pt-3 border-t border-border flex gap-2">
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Write a comment..."
            maxLength={500}
            className="flex-1 min-h-[44px] bg-surface border border-border rounded-sm px-3 py-2 text-[14px] text-text focus:border-primary transition-colors"
          />
          <button
            type="submit"
            disabled={submitting || !commentText.trim()}
            className="min-h-[44px] px-4 rounded-sm bg-primary hover:bg-primary-hover disabled:opacity-50 text-on-primary font-semibold text-[14px] flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <Send className="w-4 h-4 mr-1" />
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
};
