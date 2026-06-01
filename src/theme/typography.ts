import { StyleSheet } from 'react-native';
import { Colors } from './colors';

export const Typography = {
    fontSize: {
        xs: 11, sm: 13, base: 15, md: 17, lg: 20,
        xl: 24, '2xl': 28, '3xl': 34, '4xl': 40,
    },
};

export const textStyles = StyleSheet.create({
    h1: { fontSize: 34, fontWeight: '700', color: Colors.text.primary, letterSpacing: -0.5 },
    h2: { fontSize: 28, fontWeight: '700', color: Colors.text.primary, letterSpacing: -0.3 },
    h3: { fontSize: 24, fontWeight: '600', color: Colors.text.primary },
    h4: { fontSize: 20, fontWeight: '600', color: Colors.text.primary },
    body: { fontSize: 15, fontWeight: '400', color: Colors.text.secondary, lineHeight: 22 },
    bodySmall: { fontSize: 13, fontWeight: '400', color: Colors.text.secondary, lineHeight: 19 },
    caption: { fontSize: 11, fontWeight: '400', color: Colors.text.tertiary, lineHeight: 16 },
    label: { fontSize: 11, fontWeight: '700', color: Colors.text.tertiary, letterSpacing: 0.8, textTransform: 'uppercase' },
    mono: { fontFamily: 'monospace', fontSize: 15, color: Colors.primary[400], letterSpacing: 2 },
    monoLarge: { fontFamily: 'monospace', fontSize: 28, fontWeight: '700', color: Colors.primary[300], letterSpacing: 6 },
});