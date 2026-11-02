import * as React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'bg-zinc-100 text-zinc-900',
    secondary: 'bg-zinc-800 text-zinc-300',
    destructive: 'bg-red-950 text-red-400 border border-red-800/60',
    warning: 'bg-amber-950 text-amber-400 border border-amber-800/60',
    success: 'bg-emerald-950 text-emerald-400 border border-emerald-800/60',
    info: 'bg-sky-950 text-sky-400 border border-sky-800/60',
    outline: 'text-zinc-300 border border-zinc-700',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wider transition-colors',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
