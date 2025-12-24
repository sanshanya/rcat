// src/hooks/useTauriEvents.ts
// Unified Tauri event subscription hook with automatic cleanup

import { useEffect, useMemo, useRef } from 'react';
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
    const handlersRef = useRef<EventHandlers>(handlers);
    const eventNames = useMemo(() => Object.keys(handlers).sort(), [handlers]);
    const eventNamesKey = eventNames.join('|');

    useEffect(() => {
        handlersRef.current = handlers;
    }, [handlers]);

    useEffect(() => {
        let active = true;
        const unlisteners: UnlistenFn[] = [];

        const setupListeners = async () => {
            const registered = await Promise.all(
                eventNames.map(async (eventName) => {
                    return listen(eventName, (event) => {
                        handlersRef.current[eventName]?.(event);
                    });
                })
            );

            if (!active) {
                registered.forEach((unlisten) => unlisten());
                return;
            }

            unlisteners.push(...registered);
        };

        setupListeners();

        return () => {
            active = false;
            unlisteners.forEach((unlisten) => unlisten());
        };
    }, [eventNamesKey]);
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
    const handlerRef = useRef<EventHandler<T>>(handler);

    useEffect(() => {
        handlerRef.current = handler;
    }, [handler]);

    useEffect(() => {
        let active = true;
        let unlisten: UnlistenFn | null = null;

        const setupListener = async () => {
            const cleanup = await listen<T>(eventName, (event) => {
                handlerRef.current(event);
            });

            if (!active) {
                cleanup();
                return;
            }

            unlisten = cleanup;
        };

        setupListener();

        return () => {
            active = false;
            if (unlisten) {
                unlisten();
                unlisten = null;
            }
        };
    }, [eventName]);
}
