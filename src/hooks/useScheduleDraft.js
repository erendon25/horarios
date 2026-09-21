import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createScheduleDraft } from '../services/scheduleDraft';

export function useScheduleDraft(userId, storeId, weekKey) {
    const controller = useMemo(() => createScheduleDraft({ userId, storeId, weekKey }), [userId, storeId, weekKey]);
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    useEffect(() => {
        if (!state.dirtyStaff.size) return;
        const warn = event => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [state.dirtyStaff.size]);
    return { ...state, controller };
}
