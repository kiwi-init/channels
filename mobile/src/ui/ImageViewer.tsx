import { Cancel01Icon, Share08Icon } from "@hugeicons/core-free-icons"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Animated, Image, Modal, PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { createViewerGestures } from "../lib/viewerGestures"
import { identity, type Box, type Transform } from "../lib/zoom"
import { Icon } from "./Icon"
import { IconButton } from "./IconButton"
import { Text } from "./Text"

export interface ImageViewerProps {
  visible: boolean
  onClose: () => void
  uri: string
  title?: string
  onShare?: () => void
}

const WHITE = "#ffffff"
const FADE_OVER = 300

export function ImageViewer({ visible, onClose, uri, title, onShare }: ImageViewerProps) {
  const insets = useSafeAreaInsets()
  const [box, setBox] = useState<Box>({ width: 0, height: 0 })
  const [scale] = useState(() => new Animated.Value(1))
  const [x] = useState(() => new Animated.Value(0))
  const [y] = useState(() => new Animated.Value(0))
  const show = useCallback(
    (t: Transform) => {
      scale.setValue(t.scale)
      x.setValue(t.x)
      y.setValue(t.y)
    },
    [scale, x, y]
  )

  const springTo = useCallback(
    (t: Transform) => {
      Animated.parallel([
        Animated.spring(scale, { toValue: t.scale, useNativeDriver: true, bounciness: 0 }),
        Animated.spring(x, { toValue: t.x, useNativeDriver: true, bounciness: 0 }),
        Animated.spring(y, { toValue: t.y, useNativeDriver: true, bounciness: 0 }),
      ]).start()
    },
    [scale, x, y]
  )

  const gestures = useMemo(() => createViewerGestures({ box, show, springTo, onClose }), [box, onClose, show, springTo])
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => gestures.grant(),
        onPanResponderMove: (e, s) => gestures.move(e.nativeEvent.touches, s.dx, s.dy),
        onPanResponderRelease: (_e, s) => gestures.release(s.dx, s.dy),
        onPanResponderTerminate: () => gestures.terminate(),
      }),
    [gestures]
  )

  useEffect(() => {
    if (!visible) return
    gestures.reset()
    show(identity)
  }, [visible, gestures, show])

  const onLayout = (e: LayoutChangeEvent) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })

  if (!visible) return null

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View testID="viewer-backdrop" style={[styles.backdrop, { opacity: y.interpolate({ inputRange: [-FADE_OVER, 0, FADE_OVER], outputRange: [0.4, 1, 0.4], extrapolate: "clamp" }) }]} />
      <View testID="viewer-stage" style={styles.stage} onLayout={onLayout} {...responder.panHandlers}>
        <Animated.View style={[styles.fill, { transform: [{ translateX: x }, { translateY: y }, { scale }] }]}>
          <Image accessibilityLabel={title ?? "Image"} source={{ uri }} resizeMode="contain" style={styles.fill} />
        </Animated.View>
      </View>
      <View pointerEvents="box-none" style={[styles.bar, { paddingTop: insets.top + 8 }]}>
        <IconButton label="Close" round size={40} onPress={onClose}>
          <Icon icon={Cancel01Icon} size={20} color={WHITE} />
        </IconButton>
        <Text variant="ui" weight="medium" numberOfLines={1} style={[styles.title, { color: WHITE }]}>
          {title ?? ""}
        </Text>
        {onShare ? (
          <IconButton label="Share" round size={40} onPress={onShare}>
            <Icon icon={Share08Icon} size={20} color={WHITE} />
          </IconButton>
        ) : (
          <View style={styles.spacer} />
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000000" },
  stage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  fill: { flex: 1 },
  bar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  title: { flex: 1, textAlign: "center" },
  spacer: { width: 40, height: 40 },
})
