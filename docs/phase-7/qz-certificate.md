# QZ Tray Self-Signed Certificate

One self-signed company root cert (RSA 2048, SHA-512, 10 years) is used for
both dev and production (spec D5). The private key never leaves the server.

## Generate (run once, on a trusted machine)

    openssl req -x509 -newkey rsa:2048 -sha512 -days 3650 -nodes \
      -keyout qz-private-key.pem -out qz-certificate.pem \
      -subj "/C=ID/O=LabelBoxCRT/CN=LabelBoxCRT QZ Signing"

## Install

1. `QZ_PRIVATE_KEY` env = full content of `qz-private-key.pem`
   (escape newlines as `\n` when the host needs single-line values).
2. `QZ_CERTIFICATE` env = full content of `qz-certificate.pem` (same rule).
3. Delete `qz-private-key.pem` from the generating machine after storing it
   in the secret manager. NEVER commit either PEM.
4. Per workstation (IT): import `qz-certificate.pem` into Windows
   `certmgr.msc` → Trusted Root Certification Authorities, then restart
   QZ Tray. Without this, QZ shows an untrusted-signature warning per print.

## Endpoints

- `GET /api/qz/cert` — serves the public certificate to the QZ client.
- `POST /api/qz/sign` — authenticated + origin-allowlisted + rate-limited
  SHA-512 signing. Never logs payloads or the key.
