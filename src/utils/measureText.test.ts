import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { measureTextWidth } from "./measureText";

describe('measureTextWidth', () => {
    const canvasContextMock = {
        measureText: vi.fn(),
    };

    const canvasMock = {
        getContext: vi.fn(() => canvasContextMock),
    };

    beforeAll(() => {
        // `bun test` doesn't provide a DOM by default (no `document`/`window`).
        // Provide minimal shims so the unit test can run in both Bun and Vitest(jsdom).
        if (typeof document === "undefined") {
            Object.defineProperty(globalThis, "document", {
                value: { createElement: () => ({}) },
                writable: true,
                configurable: true,
            });
        }
        if (typeof window === "undefined") {
            Object.defineProperty(globalThis, "window", {
                value: { getComputedStyle: () => ({ font: "16px serif" }) },
                writable: true,
                configurable: true,
            });
        }
    });

    beforeEach(() => {
        canvasContextMock.measureText.mockReset();
        canvasMock.getContext.mockClear();

        const originalCreateElement = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
            if (tagName.toLowerCase() === "canvas") {
                return canvasMock as unknown as HTMLElement;
            }
            return originalCreateElement(tagName);
        });

        vi.spyOn(window, "getComputedStyle").mockReturnValue({
            font: "16px serif",
        } as unknown as CSSStyleDeclaration);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return 0 if input element is null', () => {
        expect(measureTextWidth('test', null)).toBe(0);
    });

    it('should measure width of single line text', () => {
        canvasContextMock.measureText.mockReturnValue({ width: 50 });
        const input = document.createElement('input');

        expect(measureTextWidth('hello', input)).toBe(50);
        expect(canvasContextMock.measureText).toHaveBeenCalledWith('hello');
    });

    it('should return max width for multiline text', () => {
        canvasContextMock.measureText.mockImplementation((text: string) => ({
            width: text.length * 10,
        }));
        const textarea = document.createElement('textarea');

        const width = measureTextWidth('short\nlonger line', textarea);
        expect(width).toBe(110); // "longer line" length * 10
    });
});
