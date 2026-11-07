import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' | 'warning' | 'success';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    // A button that sets its own text size keeps it: the responsive default (`sm:text-sm`) would otherwise survive
    // the class merge and override it from the sm breakpoint up.
    const ownTextSize = /(^|\s)text-(xs|sm|base|lg|\[)/.test(className ?? '');
    const baseStyles =
      'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-50 select-none';

    const variants = {
      default: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 shadow-sm active:scale-[0.98]',
      destructive: 'bg-red-600 text-white hover:bg-red-700 shadow-sm active:scale-[0.98]',
      warning: 'bg-amber-600 text-white hover:bg-amber-700 shadow-sm active:scale-[0.98]',
      success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm active:scale-[0.98]',
      outline: 'border border-zinc-700 bg-transparent hover:bg-zinc-800 text-zinc-200 active:scale-[0.98]',
      secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 active:scale-[0.98]',
      ghost: 'hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100',
      link: 'text-sky-400 underline-offset-4 hover:underline',
    };

    const sizes = {
      default: 'h-9 px-4 py-2',
      sm: 'h-7 rounded-md px-2.5 text-xs',
      lg: 'h-11 rounded-lg px-6 text-base',
      icon: 'h-8 w-8 rounded-lg',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, !ownTextSize && (size === 'default' || size === 'icon') && 'text-xs sm:text-sm', variants[variant], sizes[size], className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
