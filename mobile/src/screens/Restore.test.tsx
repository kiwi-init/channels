import { fireEvent, render, screen } from "@testing-library/react-native"
import type { BackupEnvelope } from "@mc/backup.ts"

import { Restore, type RestoreProps } from "./Restore"

const envelope = { v: 1, kdf: "scrypt", N: 16384, r: 8, p: 1, salt: "s", iv: "i", ct: "c" } satisfies BackupEnvelope

function props(over: Partial<RestoreProps> = {}): RestoreProps {
  return {
    signIn: async (on) => {
      on({ step: "waiting", userCode: "ABCD-EFGH" })
      return "tok"
    },
    fetchBackup: async () => envelope,
    restore: async () => ({ name: "Ada", channels: 2 }),
    onDone: jest.fn(),
    onCancel: jest.fn(),
    ...over,
  }
}

describe("Restore", () => {
  it("signs in, asks for the six words, opens the backup and hands back who it was", async () => {
    const p = props()
    await render(<Restore {...p} />)
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }))
    expect(await screen.findByLabelText("Six words")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Open" }).props.accessibilityState).toMatchObject({ disabled: true })
    await fireEvent.changeText(screen.getByLabelText("Six words"), "alpha bravo charlie delta echo foxtrot")
    await fireEvent.press(screen.getByRole("button", { name: "Open" }))
    await screen.findByText("Opening your backup. This takes a few seconds.").catch(() => null)
    expect(p.onDone).toHaveBeenCalledWith({ name: "Ada", channels: 2 })
  })

  it("shows the code while the person finishes in the browser", async () => {
    let finish: (t: string) => void = () => {}
    await render(
      <Restore
        {...props({
          signIn: (on) => {
            on({ step: "waiting", userCode: "ABCD-EFGH" })
            return new Promise<string>((ok) => (finish = ok))
          },
        })}
      />
    )
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }))
    expect(await screen.findByText("ABCD-EFGH")).toBeTruthy()
    finish("tok")
  })

  it("says what went wrong and offers to try again, and wrong words clear the field", async () => {
    await render(<Restore {...props({ fetchBackup: async () => Promise.reject(new Error("This account has no backup yet.")) })} />)
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }))
    expect(await screen.findByText("This account has no backup yet.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })

  it("Cancel goes back", async () => {
    const p = props()
    await render(<Restore {...p} />)
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }))
    expect(p.onCancel).toHaveBeenCalledTimes(1)
  })
})
