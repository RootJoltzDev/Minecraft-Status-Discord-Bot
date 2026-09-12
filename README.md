# Minecraft Status Bot

A Discord bot that posts a single, self-updating embed showing the status of a Minecraft server (Java or Bedrock).

## Features

- Shows **Status**, **Players Online**, **Latency**, **Version**, and **MOTD** in one embed
- Updates the **same message** every 30 seconds — no spam (edits in place, deletes duplicates)
- On restart: edits the existing embed if present; if not, removes old status embeds and posts a new one
- Java servers: tries a **direct legacy ping** first (works for servers that don't support modern status pings), then falls back to the `api.minetools.eu` API
- Bedrock servers: uses the `api.mcsrvstat.us` Bedrock API
- If no source responds, the last status is left untouched (no false "Offline")
- Strips Minecraft color codes from MOTDs and filters out bare version strings
- Uses your Discord server's custom emojis in field labels
- Shows **Last Updated** using a native Discord timestamp (renders in each viewer's local time)

## Requirements

- [Node.js](https://nodejs.org/) 18+ (discord.js v14)
- A Discord bot application with a token
- Permission to send messages and embed links in the target channel

## Installation

```bash
npm install
```

## Configuration

Edit `config.json`:

```json
{
  "token": "YOUR_BOT_TOKEN",
  "channelId": "YOUR_CHANNEL_ID",
  "mcServerIP": "play.example.com",
  "mcServerPort": 25565,
  "type": "java"
}
```

| Field        | Description                                                     |
| ------------ | --------------------------------------------------------------- |
| `token`      | Bot token from the Discord Developer Portal                     |
| `channelId`  | ID of the channel where the status embed is posted              |
| `mcServerIP` | Server hostname or IP address                                   |
| `mcServerPort` | Server port (`25565` Java, `19132` Bedrock default)          |
| `type`       | `"java"` or `"bedrock"`                                         |

> If the port matches the default for the selected type (`25565` or `19132`), it is omitted from the displayed address.

## Usage

```bash
node index.js
```

The bot logs in, finds (or creates) the status embed in the configured channel, and refreshes it every 30 seconds.

## Notes

- Custom emoji IDs in `index.js` are hard-coded for the bot's home server. To use your own server's emojis, replace the `<:name:ID>` placeholders in `fetchStatusEmbed()` and `isStatusMessage()`.
- The legacy Java ping (`0xFE`) is used because some servers (and proxies) do not answer the modern status protocol; `minetools.eu` is used as a fallback for normal servers.