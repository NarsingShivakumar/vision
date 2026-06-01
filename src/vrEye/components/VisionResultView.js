import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import Pdf from 'react-native-pdf';
import RNFS from 'react-native-fs';
import RNPrint from 'react-native-print';
import { useSelector } from 'react-redux';

// Assuming you have your printer modules exported/imported somewhere in your app.
// Update these imports to match your actual ESC/POS or thermal printer package.
// import { Printer, PrinterConstants } from 'react-native-esc-pos-printer';
// import { usePrinter } from '../hooks/usePrinter'; // Example hook if you store printers

// ── Thermal Text Formatter ───────────────────────────────────────────────────
const getThermalVisionText = (data) => {
    if (!data) return "No data available.";

    return `
                Reach Ai
             LeadWinner Corp
  ========================================
 
  Date: ${data.screenedAt || '--'}
 
  ----------------------------------------
  Patient Info
  ----------------------------------------
  Name       : ${data.patientName || '--'}
  Age/Gender : ${data.patientAge || '--'} / ${data.patientGender || '--'}
  Phone      : ${data.mobileNumber || '--'}
 
  ----------------------------------------
  Vision Screening
  ----------------------------------------
  Acuity (R) : ${data.acuityRightEye || '--'}
  Acuity (L) : ${data.acuityLeftEye || '--'}
  Near Vis.  : ${data.nearVision || '--'}
  Color Vis. : ${data.colourVision || '--'}

  Refraction (R) : ${data.dioptersRight || '-'} D | Cyl: ${data.cylRight || '-'} | Axis: ${data.axisRight || '-'}
  Refraction (L) : ${data.dioptersLeft || '-'} D | Cyl: ${data.cylLeft || '-'} | Axis: ${data.axisLeft || '-'}
  
  ----------------------------------------
  Analysis
  ----------------------------------------
  Risk Level : ${data.riskLevel || '--'}
  
  Recommendation:
  ${data.recommendation || '--'}

  ========================================
  NOTE:
  Contact an optometrist for a full 
  clinical evaluation if risk is high.
  ========================================
         ** END OF REPORT **
  `;
};

// ── The Component ────────────────────────────────────────────────────────────
export default function VisionResultView({
    patientName,
    roomCode,
    resultPdfUri,
    onEndSession
}) {
    const [pdfError, setPdfError] = useState(null);
    const [isPrintingPDF, setIsPrintingPDF] = useState(false);
    const [isPrintingThermal, setIsPrintingThermal] = useState(false);

    // Grab the JSON data fetched via Redux
    const { data: resultData, loading: resultLoading } = useSelector((state) => state.result);

    // You will need to bring in your printer discovery logic here.
    // For example: const { start, printers } = usePrinter();
    const printers = []; // MOCKED: Replace with your actual printer array state
    const start = async () => { }; // MOCKED: Replace with your actual discovery function

    // ── Print: Normal PDF ──────────────────────────────────────────────────────
    const downloadPdfForPrint = async (remoteUrl, fileName) => {
        try {
            const localPath = `${RNFS.CachesDirectoryPath}/${fileName}`;
            const downloadResult = await RNFS.downloadFile({
                fromUrl: remoteUrl,
                toFile: localPath,
            }).promise;

            if (downloadResult.statusCode === 200) {
                return localPath;
            }
            throw new Error('Failed to download PDF');
        } catch (error) {
            console.error('Error downloading PDF:', error);
            throw error;
        }
    };

    const handleNormalPrint = async () => {
        if (!resultPdfUri) return;
        setIsPrintingPDF(true);
        try {
            const fileName = `VisionReport_${roomCode}_${Date.now()}.pdf`;
            const printPath = await downloadPdfForPrint(resultPdfUri, fileName);

            if (printPath) {
                await RNPrint.print({ filePath: printPath });
                // Cleanup after print dialog opens
                RNFS.unlink(printPath).catch(err => console.log('Cleanup error:', err));
            }
        } catch (error) {
            Alert.alert("Print Error", `An error occurred: ${error.message}`);
        } finally {
            setIsPrintingPDF(false);
        }
    };

    // ── Print: Thermal Receipt ─────────────────────────────────────────────────
    const handleThermalPrint = async () => {
        if (!resultData) {
            Alert.alert("No Data", "JSON data is still loading or missing.");
            return;
        }

        setIsPrintingThermal(true);
        try {
            await start();
            await new Promise(resolve => setTimeout(resolve, 2000));

            if (!printers || printers.length === 0) {
                Alert.alert("No Printer Found", "Please discover a Bluetooth/Network printer first.");
                setIsPrintingThermal(false);
                return;
            }

            // Assuming Printer and PrinterConstants are imported properly at the top
            /*
            const printerInstance = new Printer({
              target: printers[0].target, 
              deviceName: printers[0].deviceName,
            });
      
            const receiptText = getThermalVisionText(resultData);
      
            await printerInstance.addQueueTask(async () => {
              await Printer.tryToConnectUntil(
                printerInstance,
                (status) => status.online.statusCode === PrinterConstants.TRUE
              );
      
              await printerInstance.addText(receiptText, {
                alignment: "left",
                font: "A",
                emphasized: true,
              });
      
              await printerInstance.addFeedLine(2);
              await printerInstance.addCut();
              await printerInstance.sendData();
              await printerInstance.disconnect();
              return "Success";
            });
            */

            console.log("Mock Thermal Print Success:\n", getThermalVisionText(resultData));
            Alert.alert("Success", "Vision report sent to thermal printer!");

        } catch (error) {
            console.error("Thermal Printing Error:", error);
            Alert.alert("Print Error", "Failed to communicate with the thermal printer.");
        } finally {
            setIsPrintingThermal(false);
        }
    };

    return (
        <View style={{ flex: 1 }}>
            {/* Header */}
            <View style={rs.header}>
                <View style={{ flex: 1 }}>
                    <Text style={rs.eyebrow}>Vision Screening Result</Text>
                    <Text style={rs.title}>{patientName || 'Patient'}</Text>
                    {roomCode ? <Text style={rs.room}>Room: {roomCode}</Text> : null}
                </View>

                <View style={{ gap: 8, flexDirection: 'row' }}>
                    <TouchableOpacity
                        style={rs.printBtn}
                        onPress={handleThermalPrint}
                        disabled={isPrintingThermal || resultLoading}
                    >
                        {isPrintingThermal || resultLoading ? (
                            <ActivityIndicator color="#000" size="small" />
                        ) : (
                            <Text style={rs.printBtnText}>🖨️ Receipt</Text>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={rs.printBtn}
                        onPress={handleNormalPrint}
                        disabled={isPrintingPDF || !resultPdfUri}
                    >
                        {isPrintingPDF ? (
                            <ActivityIndicator color="#000" size="small" />
                        ) : (
                            <Text style={rs.printBtnText}>📄 A4 Print</Text>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity style={rs.newSessionBtn} onPress={onEndSession}>
                        <Text style={rs.newSessionBtnText}>New Session</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* PDF Viewer */}
            <View style={rs.pdfSection}>
                {resultPdfUri ? (
                    <Pdf
                        source={{ uri: resultPdfUri, cache: false }}
                        style={rs.pdf}
                        trustAllCerts={false}
                        onError={(error) => setPdfError(error?.message ?? 'Could not load result PDF.')}
                    />
                ) : (
                    <View style={rs.noPdfBox}>
                        <ActivityIndicator color="#5b5bd6" />
                        <Text style={rs.noPdfText}>Preparing result report…</Text>
                    </View>
                )}

                {pdfError ? (
                    <View style={rs.pdfErrorBox}>
                        <Text style={rs.pdfErrorText}>⚠ {pdfError}</Text>
                        <TouchableOpacity onPress={() => setPdfError(null)} style={{ marginTop: 8 }}>
                            <Text style={{ color: '#7c7cf0', fontSize: 12 }}>Dismiss</Text>
                        </TouchableOpacity>
                    </View>
                ) : null}
            </View>
        </View>
    );
}

const rs = StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: 'rgba(255,255,255,0.03)', borderBottomWidth: 1, borderBottomColor: 'rgba(124,124,240,0.12)' },
    eyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 2, color: '#7c7cf0', textTransform: 'uppercase', marginBottom: 4 },
    title: { fontSize: 18, fontWeight: '600', color: '#e8e8f0' },
    room: { fontSize: 11, color: '#555', marginTop: 3 },
    printBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#f9a825', borderRadius: 8, justifyContent: 'center' },
    printBtnText: { color: '#000', fontSize: 12, fontWeight: '700' },
    newSessionBtn: { paddingVertical: 8, paddingHorizontal: 14, backgroundColor: 'rgba(91,91,214,0.15)', borderWidth: 1, borderColor: 'rgba(91,91,214,0.3)', borderRadius: 8, justifyContent: 'center' },
    newSessionBtnText: { color: '#7c7cf0', fontSize: 12, fontWeight: '600' },
    pdfSection: { flex: 1, backgroundColor: '#000' },
    pdf: { flex: 1, width: '100%' },
    noPdfBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
    noPdfText: { color: '#666', fontSize: 13 },
    pdfErrorBox: { position: 'absolute', bottom: 20, left: 16, right: 16, backgroundColor: 'rgba(204,51,51,0.9)', borderRadius: 12, padding: 14, alignItems: 'center' },
    pdfErrorText: { color: '#fff', fontSize: 13, textAlign: 'center' },
});