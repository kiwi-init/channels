import { useState } from "react"
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native"

import { useTheme } from "../theme/useTheme"
import { FAMILY } from "./Text"

export interface TextFieldProps extends Omit<TextInputProps, "style"> {
  label: string
}

export function TextField({ label, multiline, editable = true, onFocus, onBlur, ...rest }: TextFieldProps) {
  const { colors, radius, type } = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <View
      style={[
        styles.shell,
        multiline ? styles.multiline : styles.single,
        { backgroundColor: colors.canvas, borderColor: focused ? colors.ring : colors.line, borderRadius: radius.ctl },
        !editable && styles.disabled,
      ]}
    >
      <TextInput
        {...rest}
        multiline={multiline}
        accessibilityLabel={label}
        editable={editable}
        placeholderTextColor={colors.ink3}
        selectionColor={colors.accent}
        onFocus={(e) => {
          setFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        style={[styles.input, type.body, { color: colors.ink, fontFamily: FAMILY.regular, textAlignVertical: multiline ? "top" : "center" }]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  shell: { borderWidth: 1, paddingHorizontal: 12, justifyContent: "center" },
  single: { height: 40 },
  multiline: { minHeight: 40, paddingVertical: 8 },
  input: { flex: 1, padding: 0 },
  disabled: { opacity: 0.4 },
})
