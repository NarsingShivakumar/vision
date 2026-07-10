import { StyleSheet, Switch, Text, View, ActivityIndicator } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { startKioskMode, stopKioskMode, isKioskModeEnabled } from "../services/kioskMode";
import { appColor } from "../../assets/colors";

const CustomHeader = ({ kioskLocked = false }) => {
    const [kioskEnabled, setKioskEnabled] = useState(Boolean(kioskLocked));
    const [isLoading, setIsLoading] = useState(!kioskLocked);

    const refreshStatus = useCallback(async () => {
        try {
            if (kioskLocked) {
                // Test started, so show ON first time
                setKioskEnabled(true);
                setIsLoading(false);
                return;
            }

            const status = await isKioskModeEnabled();
            setKioskEnabled(Boolean(status));
        } catch (e) {
            console.log("Kiosk status check failed:", e);
        } finally {
            setIsLoading(false);
        }
    }, [kioskLocked]);

    useEffect(() => {
        if (kioskLocked) {
            // Show switch ON when test starts
            setKioskEnabled(true);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);

        const timer = setTimeout(() => {
            refreshStatus();
        }, 400);

        return () => clearTimeout(timer);
    }, [refreshStatus, kioskLocked]);

    const togglePin = async (value) => {
        setKioskEnabled(value);

        try {
            if (value) {
                await startKioskMode();
                setKioskEnabled(true);
            } else {
                await stopKioskMode();
                setKioskEnabled(false);
            }
        } catch (e) {
            console.log("Kiosk toggle failed:", e);

            const status = await isKioskModeEnabled();
            setKioskEnabled(Boolean(status));
        }
    };

    return (
        <View style={styles.headerContainer}>
            <Text style={styles.pinLabel}>📌 App Pin</Text>

            <View style={{ alignItems: "center", justifyContent: "center", minHeight: 40 }}>
                {isLoading ? (
                    <ActivityIndicator size="small" color="black" />
                ) : (
                    <Switch
                        onValueChange={togglePin}
                        value={kioskEnabled}
                    />
                )}

                {kioskLocked && !isLoading && <Text style={styles.lockedHint}>Locked during test</Text>} {kioskLocked && !isLoading && <Text style={styles.lockedHint}>Unpin for exit</Text>}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    headerContainer: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        backgroundColor: appColor,
        paddingHorizontal: 16,
        height: 60,
    },
    pinLabel: {
        fontSize: 16,
        fontWeight: "bold",
        color: "black",
    },
    lockedHint: {
        fontSize: 9,
        color: "black",
        opacity: 0.6,
        marginTop: 2,
    },
});

export default CustomHeader;