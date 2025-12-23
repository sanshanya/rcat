import React from 'react';

interface ResizeHandleProps {
  onResize: (dx: number, dy: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  className?: string;
}

const ResizeHandle = ({ onResize, onResizeStart, onResizeEnd, className = "" }: ResizeHandleProps) => {
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.screenX;
    const startY = e.screenY;
    const target = e.target as HTMLElement;
    
    target.setPointerCapture(e.pointerId);
    
    if (onResizeStart) onResizeStart();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      // Calculate delta from current position to start position
      // Using screen coordinates avoids issues when window resizes/moves under cursor
      const dx = moveEvent.screenX - startX;
      const dy = moveEvent.screenY - startY;
      
      onResize(dx, dy);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener('pointermove', handlePointerMove);
      target.removeEventListener('pointerup', handlePointerUp);
      
      if (onResizeEnd) onResizeEnd();
    };

    target.addEventListener('pointermove', handlePointerMove);
    target.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <div
      className={`resize-handle ${className}`}
      onPointerDown={handlePointerDown}
      style={{
        position: 'absolute',
        bottom: 2,
        right: 2,
        width: '16px',
        height: '16px',
        cursor: 'nwse-resize',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        opacity: 0.5,
      }}
    >
       <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ pointerEvents: 'none' }}>
         <path d="M8 2L8 8M8 8L2 8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.5"/>
         <path d="M5 5L8 8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.5"/>
       </svg>
    </div>
  );
};

export default ResizeHandle;
