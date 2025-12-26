import { describe, it, expect, vi, beforeEach } from 'vitest';
import { measureTextWidth } from './measureText';

describe('measureTextWidth', () => {
    let canvasContextMock: { measureText: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        // Mock canvas and context
        canvasContextMock = {
            measureText: vi.fn(),
        };
        const canvasMock = {
            getContext: vi.fn(() => canvasContextMock),
        };
        vi.spyOn(document, 'createElement').mockReturnValue(canvasMock as unknown as HTMLElement);
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({
            font: '16px serif',
        } as unknown as CSSStyleDeclaration);
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
