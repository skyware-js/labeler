<p align="center">
	<img src="https://github.com/skyware-js/.github/blob/main/assets/logo-dark.png?raw=true" height="72">
</p>
<h1 align="center">@skyware/labeler</h1>

A lightweight alternative to Ozone for operating an atproto labeler.

[Documentation](https://skyware.js.org/docs/firehose)

## CLI

The `@skyware/labeler` package also comes with a CLI for setting up and managing a labeler.

```sh
$ npx @skyware/labeler
Usage: npx @skyware/labeler [command]
Commands:
  setup - Initialize an account as a labeler.
  clear - Restore a labeler account to normal.
  label add - Add new label declarations to a labeler account.
  label delete - Remove label declarations from a labeler account.
```

For a full guide to setting up a labeler, see [Getting Started](https://skyware.js.org/guides/labeler/introduction/getting-started).

## Installation

```sh
npm install @skyware/labeler
```

## Example Usage

This library requires an existing labeler declaration. To get set up, refer to the [Getting Started](https://skyware.js.org/guides/labeler/introduction/getting-started) guide.

```js
import { LabelerServer } from "@skyware/labeler";

const server = new LabelerServer({ did: "···", signingKey: "···" });

server.start(14831, (error, address) => {
    if (error) {
        console.error(error);
    } else {
        console.log(`Labeler server listening on ${address}`);
    }
});
```

# Advanced

## Bringing Your Own Database
`@skyware/labeler` uses libsql by default, but can be configured prograamatically to use any database of your choosing. Instead of creating an ORM, the labeler constructor exposes a `dbCallbacks` property for registering your database callbacks for every significant operation. All callbacks are asynchronous, although it's your responsibility to check the resolved state of your connection before performing additional operations.

A sample implementation can be found in `src/util/sqlite.ts`.
