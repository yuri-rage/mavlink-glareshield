// Newest-first / oldest-first order for a STATUSTEXT list, remembered per widget, with the scrolling each order
// needs: oldest-first keeps following new messages at the bottom (unless scrolled up), newest-first jumps to the
// top when the order changes.

import { useEffect, useRef, useState } from 'react';

export type MessageSortOrder = 'newest' | 'oldest';

function readOrder(storageKey: string, fallback: MessageSortOrder): MessageSortOrder {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'newest' || saved === 'oldest') return saved;
  } catch {
    // Storage blocked: use the default.
  }
  return fallback;
}

/** `messages` is newest first, as the store keeps them. */
export function useMessageSort<T>(messages: T[], storageKey: string, fallback: MessageSortOrder = 'newest') {
  const [sortOrder, setSortOrder] = useState<MessageSortOrder>(() => readOrder(storageKey, fallback));
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const prevOrderRef = useRef(sortOrder);

  const toggleSortOrder = () => {
    setSortOrder((prev) => {
      const next = prev === 'newest' ? 'oldest' : 'newest';
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Not remembered; still applies for this session.
      }
      return next;
    });
  };

  const displayed = sortOrder === 'newest' ? messages : [...messages].reverse();

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const orderChanged = prevOrderRef.current !== sortOrder;
    prevOrderRef.current = sortOrder;
    if (sortOrder === 'oldest') {
      if (orderChanged || atBottomRef.current) el.scrollTop = el.scrollHeight;
    } else if (orderChanged) {
      el.scrollTop = 0;
    }
    // Keyed on the newest message, not the count: the store keeps the last 100, so past that the count stops
    // changing while messages keep arriving (and a repeat bumps a count in place).
  }, [messages[0], messages.length, sortOrder]);

  return { sortOrder, toggleSortOrder, displayed, scrollRef, onScroll };
}
