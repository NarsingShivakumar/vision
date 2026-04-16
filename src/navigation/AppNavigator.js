import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import ShareScreen from '../screens/ShareScreen';
import DiscoverDevicesScreen from '../screens/DiscoverDevicesScreen';
import RemoteViewerScreen from '../screens/RemoteViewerScreen';
import PermissionCenterScreen from '../screens/PermissionCenterScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
    return (
        <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
                headerStyle: { backgroundColor: '#1a1d2e' },
                headerTintColor: '#fff',
                headerTitleStyle: { fontWeight: '700' },
            }}
        >
            <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'ScreenCast' }} />
            <Stack.Screen name="ShareScreen" component={ShareScreen} options={{ title: 'Share My Screen' }} />
            <Stack.Screen name="DiscoverDevices" component={DiscoverDevicesScreen} options={{ title: 'Find a Device' }} />
            <Stack.Screen name="RemoteViewer" component={RemoteViewerScreen} options={{ headerShown: false }} />
            <Stack.Screen name="PermissionCenter" component={PermissionCenterScreen} options={{ title: 'Permissions & Approvals' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        </Stack.Navigator>
    );
}