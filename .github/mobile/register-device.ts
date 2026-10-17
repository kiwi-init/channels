import { createSign } from "node:crypto"

const keyId = process.env.APPLE_API_KEY_ID
const issuer = process.env.APPLE_API_ISSUER
const keyFile = process.env.APPLE_API_KEY_FILE
const udid = process.env.DEVICE_UDID
const name = process.env.DEVICE_NAME ?? "iPhone"

if (!keyId || !issuer || !keyFile || !udid) {
  console.log("no device to register")
  process.exit(0)
}

const b64 = (data: Buffer | string): string => Buffer.from(data).toString("base64url")

const now = Math.floor(Date.now() / 1000)
const head = b64(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }))
const body = b64(JSON.stringify({ iss: issuer, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }))
const sign = createSign("SHA256")
sign.update(`${head}.${body}`)
const signature = sign.sign({ key: await Bun.file(keyFile).text(), dsaEncoding: "ieee-p1363" })
const token = `${head}.${body}.${b64(signature)}`

const res = await fetch("https://api.appstoreconnect.apple.com/v1/devices", {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ data: { type: "devices", attributes: { name, udid, platform: "IOS" } } }),
})

if (res.ok) console.log("device registered")
else if (res.status === 409) console.log("device already registered")
else {
  console.error(`could not register the device: ${res.status}`)
  process.exit(1)
}
