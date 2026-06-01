import React, { useEffect, useRef, useState } from 'react';
import { Alert, LogBox } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Splash from './src/Splash';
import { SafeAreaView } from 'react-native-safe-area-context';
import RoleAndConnectScreen from './src/vrEye/screens/RoleAndConnectScreen';
import PatientScreen from './src/vrEye/screens/PatientScreen';
import ControllerScreen from './src/vrEye/screens/ControllerScreen';

// Ignore all log notifications
LogBox.ignoreAllLogs(true);
const Stack = createNativeStackNavigator();

function App() {
  const navigationContainerRef = useRef();

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
      <NavigationContainer ref={navigationContainerRef}>
        <Stack.Navigator
          initialRouteName="Splash"
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="Splash" component={Splash} />
          <Stack.Screen name="RoleAndConnectScreen" component={RoleAndConnectScreen} options={{ headerShown: false }} />
          <Stack.Screen name="PatientScreen" component={PatientScreen} options={{ headerShown: false }} />
          <Stack.Screen name="ControllerScreen" component={ControllerScreen} options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  );
}

export default App;