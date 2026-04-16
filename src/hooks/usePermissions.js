import { useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { check, request, PERMISSIONS, RESULTS, openSettings } from 'react-native-permissions';

function getRequired() {
    if (Platform.OS !== 'android') return [];
    const perms = [PERMISSIONS.ANDROID.RECORD_AUDIO];
    if (Platform.Version >= 33) perms.push(PERMISSIONS.ANDROID.POST_NOTIFICATIONS);
    return perms;
}

export function usePermissions() {
    const [statuses, setStatuses] = useState({});

    const checkAll = useCallback(async () => {
        const result = {};
        for (const p of getRequired()) result[p] = await check(p);
        setStatuses(result);
        return result;
    }, []);

    const requestAll = useCallback(async () => {
        const result = {};
        for (const p of getRequired()) result[p] = await request(p);
        setStatuses(result);
        return result;
    }, []);

    const requestOne = useCallback(async perm => {
        const result = await request(perm);
        setStatuses(prev => ({ ...prev, [perm]: result }));
        return result;
    }, []);

    const allGranted = getRequired().every(
        p => statuses[p] === RESULTS.GRANTED || statuses[p] === RESULTS.LIMITED
    );

    return { statuses, checkAll, requestAll, requestOne, allGranted, openSettings };
}