import { CameraView, useCameraPermissions } from "expo-camera"
import { useRef } from "react"
import { StyleSheet, View } from "react-native"

import { Button } from "./Button"
import { Text } from "./Text"

export interface QrScannerProps {
  onCode: (text: string) => void
  onClose: () => void
}

export function QrScanner({ onCode, onClose }: QrScannerProps) {
  const [permission, ask] = useCameraPermissions()
  const taken = useRef(false)
  if (!permission) return null
  if (!permission.granted) {
    return (
      <View style={styles.column}>
        <Text tone="ink2">Kiwi needs the camera to scan the code on your desktop.</Text>
        <View style={styles.row}>
          <Button title="Allow the camera" onPress={() => void ask()} />
          <Button title="Type it instead" variant="secondary" onPress={onClose} />
        </View>
      </View>
    )
  }
  return (
    <View style={styles.column}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (taken.current) return
          taken.current = true
          onCode(data)
        }}
      />
      <Button title="Type it instead" variant="secondary" onPress={onClose} />
    </View>
  )
}

const styles = StyleSheet.create({
  column: { gap: 12 },
  row: { flexDirection: "row", gap: 8 },
  camera: { width: "100%", aspectRatio: 1, borderRadius: 16, overflow: "hidden" },
})
