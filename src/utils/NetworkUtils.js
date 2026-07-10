import NetInfo from '@react-native-community/netinfo';

const checkNetworkConnectivity = async () => {
  try {
    const state = await NetInfo.fetch();
    const isConnected = state.isConnected && state.isInternetReachable 
    // Quick check: if not connected to network, return false
    if (!isConnected) {
    return false ;
    }
    // Verify actual internet connectivity with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    
    try {
      // Google's generate_204 endpoint is specifically designed for connectivity checks
      const response = await fetch('https://www.google.com/generate_204', {
        method: 'HEAD',
        cache: 'no-cache',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return response.status === 204;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      return false;
    }
  } catch (error) {
    console.error('Error checking network connectivity:', error);
    return false;
  }
};

export default checkNetworkConnectivity;
