import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import sharingReducer from './slices/sharingSlice';
import discoveryReducer from './slices/discoverySlice';
import controlReducer from './slices/controlSlice';
import wifiReducer from './slices/wifiSlice';
import peerReducer from './slices/peerSlice';
import resultReducer from './slices/resultSlice';

export const store = configureStore({
    reducer: {
        sharing: sharingReducer,
        discovery: discoveryReducer,
        control: controlReducer,
        wifi: wifiReducer,
        peer: peerReducer,
        result: resultReducer,

    },
    middleware: g => g({ serializableCheck: { ignoredActions: ['sharing/updateStreamStats'] } }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;