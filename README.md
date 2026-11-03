# @verifiabl/issuer

The Verifiabl issuer SDK for Node.js. It registers payslip records with Verifiabl and makes their QR codes.

## Documentation

- [Issuer SDK guide](https://docs.verifiabl.io/issuer-sdk?lang=node)
- [API reference](https://docs.verifiabl.io/api-reference/sdks/node)

## Requirements

Node.js 20 or newer.

## Installation

```sh
npm install @verifiabl/issuer
```

## Usage

Create one client with the client ID and client secret from your onboarding:

```ts
import { VerifiablClient } from "@verifiabl/issuer";

const client = new VerifiablClient({
  environment: "sandbox",
  auth: {
    clientId: process.env.VERIFIABL_CLIENT_ID!,
    clientSecret: process.env.VERIFIABL_CLIENT_SECRET!,
  },
});
```

To prepare and register payslips and make their QR codes, follow the [issuer SDK guide](https://docs.verifiabl.io/issuer-sdk?lang=node).

Before the first send, save each prepared `registration` and its ciphertext together. After a failure or restart, send that saved registration unchanged. It carries its reference, so the API does not register it twice. Preparing the payslip again makes a new reference. An `apiManagedRegistration` has no reference, so do not resend it after an ambiguous failure. See [Register again later](https://docs.verifiabl.io/issuer-sdk/retries-and-timeouts?lang=node#register-again-later).

## Support

Report issues at [github.com/Verifiabl/verifiabl-node](https://github.com/Verifiabl/verifiabl-node/issues). To build and test the SDK, see [DEVELOPMENT.md](https://github.com/Verifiabl/verifiabl-node/blob/main/DEVELOPMENT.md).

## License

MIT. See [LICENSE](https://github.com/Verifiabl/verifiabl-node/blob/main/LICENSE).
