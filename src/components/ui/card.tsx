import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * True inside a composite widget panel that holds a built-in widget: the built-in's card then drops its own frame
 * (border, background, shadow) and padding, since the panel already draws one.
 */
export const CardEmbedContext = React.createContext(false);

const EMBED_CARD = 'border-0 ring-0 rounded-none bg-transparent shadow-none backdrop-blur-none';
const EMBED_HEADER = 'bg-transparent px-0 pt-0 pb-1.5 sm:px-0';
const EMBED_CONTENT = 'px-0 sm:px-0 pb-0 sm:pb-0';

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const embedded = React.useContext(CardEmbedContext);
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl border border-zinc-800 bg-zinc-950/80 text-zinc-100 shadow-md backdrop-blur-sm transition-all',
          className,
          embedded && EMBED_CARD
        )}
        {...props}
      />
    );
  }
);
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const embedded = React.useContext(CardEmbedContext);
    return <div ref={ref} className={cn('flex flex-col py-1.5 px-3 sm:px-3.5', className, embedded && EMBED_HEADER)} {...props} />;
  }
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('font-semibold leading-none tracking-tight text-zinc-100 text-sm sm:text-base flex items-center', className)} {...props} />
  )
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-xs text-zinc-400', className)} {...props} />
  )
);
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const embedded = React.useContext(CardEmbedContext);
    return <div ref={ref} className={cn('p-4 sm:p-5 pt-0', className, embedded && EMBED_CONTENT)} {...props} />;
  }
);
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-4 sm:p-5 pt-0', className)} {...props} />
  )
);
CardFooter.displayName = 'CardFooter';
