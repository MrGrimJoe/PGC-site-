import React, { useState } from 'react';
import { Flag, X } from 'lucide-react';

interface ReportModalProps {
  targetType: 'post' | 'comment' | 'user';
  targetId: string;
  onClose: () => void;
  onReportSubmitted: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  targetType,
  targetId,
  onClose,
  onReportSubmitted,
}) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          reason: reason.trim(),
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || 'Failed to submit report');
      }

      onReportSubmitted();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#17233A]/40 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-card p-4 max-w-[420px] w-full space-y-4 shadow-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Flag className="w-5 h-5 text-danger" />
            <h3 className="text-[16px] font-semibold text-text">Report {targetType}</h3>
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
          <div className="p-2.5 rounded-sm bg-danger-tint border border-danger text-danger text-[12px]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="report-reason" className="block text-[12px] font-semibold text-text mb-1">
              Reason for report
            </label>
            <textarea
              id="report-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the issue (spam, abuse, inappropriate content)..."
              maxLength={500}
              required
              className="w-full bg-surface border border-border rounded-sm p-3 text-[14px] text-text focus:border-primary resize-none transition-colors"
            />
          </div>

          <div className="flex space-x-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-[44px] px-3 rounded-sm border border-border bg-surface text-text hover:bg-bg text-[14px] font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !reason.trim()}
              className="flex-1 min-h-[44px] px-3 rounded-sm bg-primary hover:bg-primary-hover disabled:opacity-50 text-on-primary text-[14px] font-semibold transition-colors cursor-pointer"
            >
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
