import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PatientScreen from '../vrEye/screens/PatientScreen';
import RoleAndConnectScreen from '../vrEye/screens/RoleAndConnectScreen';
import ControllerScreen from '../vrEye/screens/ControllerScreen';
import Splash from '../Splash'

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
    return (
        <Stack.Navigator
            initialRouteName="Splash"
            screenOptions={{
                headerStyle: { backgroundColor: '#1a1d2e' },
                headerTintColor: '#fff',
                headerTitleStyle: { fontWeight: '700' },
            }}
        >
            <Stack.Screen
                name="Splash"
                component={Splash}
            />

            <Stack.Screen
                name="RoleAndConnectScreen"
                component={RoleAndConnectScreen}
            />

            <Stack.Screen
                name="PatientScreen"
                component={PatientScreen}
            />

            <Stack.Screen
                name="ControllerScreen"
                component={ControllerScreen}
            />
        </Stack.Navigator>
    );
}