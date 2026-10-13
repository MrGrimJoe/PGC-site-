import React from 'react';
import { Clock } from 'lucide-react';

interface ExpiryChipProps {
  expiresAt: string;
}

export const ExpiryChip: React.FC<ExpiryChipProps> = ({ expiresAt }) => {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();

  if (remainingMs <= 0) {
    return (
      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-pill text-[11px] font-semibold bg-danger-tint text-danger border border-danger">
        <Clock className="w-3 h-3" />
        <span>Expired</span>
      </span>
    );
  }

  const hoursRemaining = remainingMs / (1000 * 60 * 60);

  // Red chip under 24 hours
  if (hoursRemaining < 24) {
    const text =
      hoursRemaining < 1
        ? `${Math.max(1, Math.floor(remainingMs / (1000 * 60)))}m left`
        : `${Math.floor(hoursRemaining)}h left`;
    return (
      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-pill text-[11px] font-semibold bg-danger-tint text-danger border border-danger">
        <Clock className="w-3 h-3" />
        <span>{text}</span>
      </span>
    );
  }

  // Yellow chip under 48 hours
  if (hoursRemaining < 48) {
    const text = `${Math.floor(hoursRemaining)}h left`;
    return (
      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-pill text-[11px] font-semibold bg-accent text-accent-text">
        <Clock className="w-3 h-3" />
        <span>{text}</span>
      </span>
    );
  }

  // Normal grey chip 48h and above
  const days = Math.ceil(hoursRemaining / 24);
  return (
    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-pill text-[11px] text-text-muted bg-bg border border-border">
      <Clock className="w-3 h-3" />
      <span>{days}d left</span>
    </span>
  );
};
