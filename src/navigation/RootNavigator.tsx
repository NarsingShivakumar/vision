import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// import your new screens
import PatientScreen from '../vrEye/screens/PatientScreen';
import RoleAndConnectScreen from '../vrEye/screens/RoleAndConnectScreen';
import ControllerScreen from '../vrEye/screens/ControllerScreen';
import Splash from '../Splash'
export type RootStackParamList = {
  Splash: undefined;
  PatientScreen: undefined;
  RoleAndConnectScreen: undefined;
  ControllerScreen: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const RootNavigator: React.FC = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="RoleAndConnectScreen"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Splash" component={Splash} />
        <Stack.Screen name="RoleAndConnectScreen" component={RoleAndConnectScreen} />
        <Stack.Screen name="PatientScreen" component={PatientScreen} />
        <Stack.Screen name="ControllerScreen" component={ControllerScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default RootNavigator;