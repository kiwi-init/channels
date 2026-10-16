import { useEffect, useState, type ReactNode } from "react"
import { AccessibilityInfo, Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { shadowStyle } from "../theme/shadow"
import { useTheme } from "../theme/useTheme"
import { Text } from "./Text"

const IN_MS = 240
const OUT_MS = 180

export interface SheetProps {
  visible: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

export function Sheet({ visible, onClose, title, children }: SheetProps) {
  const { colors, radius, shadow } = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const [shown, setShown] = useState(visible)
  const [progress] = useState(() => new Animated.Value(visible ? 1 : 0))
  if (visible && !shown) setShown(true)

  useEffect(() => {
    let live = true
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!live) return
      const run = Animated.timing(progress, {
        toValue: visible ? 1 : 0,
        duration: reduced ? 0 : visible ? IN_MS : OUT_MS,
        easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: true,
      })
      run.start(({ finished }) => {
        if (finished && !visible && live) setShown(false)
      })
    })
    return () => {
      live = false
    }
  }, [visible, progress])

  if (!shown) return null

  return (
    <Modal testID="sheet" transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: progress }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.end} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            shadowStyle(shadow),
            {
              maxHeight: height * 0.85,
              backgroundColor: colors.raised,
              borderTopLeftRadius: radius.bubble,
              borderTopRightRadius: radius.bubble,
              paddingBottom: insets.bottom + 12,
              transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }],
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.edgeStrong }]} />
          {title ? (
            <View style={styles.title}>
              <Text variant="title" accessibilityRole="header">
                {title}
              </Text>
            </View>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  end: { flex: 1, justifyContent: "flex-end" },
  sheet: { width: "100%" },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, marginTop: 8, marginBottom: 4 },
  title: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  body: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
})
