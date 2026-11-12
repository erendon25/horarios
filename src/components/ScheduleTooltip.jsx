import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ScheduleTooltip({ id, anchor, container, onMouseEnter, onMouseLeave, children, testId, preferSide = false, className }) {
    const ref = useRef(null);
    const [position, setPosition] = useState(null);

    useLayoutEffect(() => {
        if (!anchor?.isConnected || !ref.current) return;
        const cell = anchor.getBoundingClientRect();
        const tooltip = ref.current.getBoundingClientRect();
        let left = Math.max(8, Math.min(cell.left + cell.width / 2 - tooltip.width / 2, window.innerWidth - tooltip.width - 8));
        const above = cell.top - tooltip.height - 8;
        let top = above >= 8 ? above : Math.min(cell.bottom + 8, window.innerHeight - tooltip.height - 8);
        if (preferSide && (cell.left >= tooltip.width + 16 || cell.right + tooltip.width + 16 <= window.innerWidth)) {
            left = cell.left >= tooltip.width + 16 ? cell.left - tooltip.width - 8 : cell.right + 8;
            top = Math.min(cell.top, window.innerHeight - tooltip.height - 8);
        }
        setPosition({ left, top: Math.max(8, top) });
    }, [anchor, children, preferSide]);

    return createPortal(
        <div ref={ref} id={id} role="tooltip" data-testid={testId}
            onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
            className={`fixed z-[100] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] overflow-y-auto break-words shadow-xl ${className || 'w-72 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-xs leading-relaxed text-white'}`}
            style={position || { left: 0, top: 0, visibility: 'hidden' }}>
            {children}
        </div>, container || document.body
    );
}
