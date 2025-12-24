// src/hooks/useTauriEvents.ts
// Unified Tauri event subscription hook with automatic cleanup

import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn, type Event } from '@tauri-apps/api/event';

/**
 * Event handler type
 */
export type EventHandler<T = unknown> = (event: Event<T>) => void;

/**
 * Event handlers map
 */
export type EventHandlers = Record<string, EventHandler<unknown>>;

/**
 * Hook for subscribing to multiple Tauri events with automatic cleanup.
 * All subscriptions are managed and cleaned up when the component unmounts
 * or when the handlers change.
 *
 * @example
 * ```tsx
 * useTauriEvents({
 *   'click-through-state': (event) => setIsClickThrough(event.payload),
 *   'chat-stream': (event) => handleChunk(event.payload),
 * });
 * ```
 */
export function useTauriEvents(handlers: EventHandlers): void {
    // Use ref to store cleanup functions
    const unlistenersRef = useRef<UnlistenFn[]>([]);

    useEffect(() => {
        const setupListeners = async () => {
            // Clean up previous listeners
            unlistenersRef.current.forEach((unlisten) => unlisten());
            unlistenersRef.current = [];

            // Set up new listeners
            const entries = Object.entries(handlers);
            const unlisteners = await Promise.all(
                entries.map(async ([eventName, handler]) => {
                    return listen(eventName, handler);
                })
            );

            unlistenersRef.current = unlisteners;
        };

        setupListeners();

        // Cleanup on unmount
        return () => {
            unlistenersRef.current.forEach((unlisten) => unlisten());
            unlistenersRef.current = [];
        };
    }, [handlers]);
}

/**
 * Hook for subscribing to a single Tauri event with automatic cleanup.
 *
 * @example
 * ```tsx
 * useTauriEvent('click-through-state', (event) => {
 *   setIsClickThrough(event.payload);
 * });
 * ```
 */
export function useTauriEvent<T>(
    eventName: string,
    handler: EventHandler<T>
): void {
    const unlistenRef = useRef<UnlistenFn | null>(null);

    useEffect(() => {
        const setupListener = async () => {
            // Clean up previous listener
            if (unlistenRef.current) {
                unlistenRef.current();
            }

            // Set up new listener
            unlistenRef.current = await listen<T>(eventName, handler);
        };

        setupListener();

        // Cleanup on unmount
        return () => {
            if (unlistenRef.current) {
                unlistenRef.current();
                unlistenRef.current = null;
            }
        };
    }, [eventName, handler]);
}
