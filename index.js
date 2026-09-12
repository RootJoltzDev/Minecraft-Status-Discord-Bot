const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const net = require('net');
const config = require('./config.json');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

let statusMessage = null;

function getFullServerAddress() {
  const ip = config.mcServerIP;
  const port = config.mcServerPort;
  const isDefaultPort = (config.type === 'bedrock' && Number(port) === 19132) || (config.type !== 'bedrock' && Number(port) === 25565);

  if (port && !isDefaultPort) {
    return `${ip}:${port}`;
  }
  return ip;
}

function stripColorCodes(text) {
  text = typeof text === 'string' ? text : text?.text || '';
  return text.replace(/§[0-9a-fk-or]/gi, '').replace(/&[0-9a-fk-or]/gi, '').trim();
}

function getIconUrl(serverAddress, isBedrock) {
  return isBedrock
    ? `https://api.mcsrvstat.us/icon/${encodeURIComponent(serverAddress)}`
    : `https://eu.mc-api.net/v3/server/favicon/${encodeURIComponent(serverAddress)}`;
}

function splitAddress(serverAddress) {
  const idx = serverAddress.lastIndexOf(':');
  if (idx > -1) {
    return { host: serverAddress.slice(0, idx), port: Number(serverAddress.slice(idx + 1)) };
  }
  return { host: serverAddress, port: Number(config.mcServerPort) };
}

function pingLegacy(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port, timeout: 8000 });
    let buffer = Buffer.alloc(0);
    let settled = false;
    const done = (fn, arg) => {
      if (!settled) {
        settled = true;
        fn(arg);
        socket.destroy();
      }
    };
    socket.on('connect', () => socket.write(Buffer.from([0xFE, 0x01])));
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer[0] === 0xFF) done(resolve, buffer);
      else done(reject, new Error('Unexpected legacy ping response'));
    });
    socket.on('error', (err) => done(reject, err));
    socket.on('close', () => {
      if (!settled) done(reject, new Error('Connection closed without response'));
    });
    socket.setTimeout(8000, () => done(reject, new Error('Legacy ping timeout')));
  });
}

function parseLegacy(buffer) {
  if (buffer[0] !== 0xFF || buffer.length < 6) throw new Error('Invalid legacy ping response');
  const body = buffer.subarray(1);
  let str = '';
  for (let i = 0; i + 1 < body.length; i += 2) {
    str += String.fromCharCode((body[i] << 8) | body[i + 1]);
  }
  const parts = str.split('\u0000').map((p) => p.trim()).filter((p) => p.length);
  if (!parts.length) throw new Error('Legacy ping response has no data');

  const numbers = [];
  for (let i = parts.length - 1; i >= 0 && numbers.length < 2; i--) {
    if (/^\d+$/.test(parts[i])) numbers.push(parseInt(parts[i], 10));
  }
  const playersOnline = numbers[1] ?? 0;
  const playersMax = numbers[0] ?? 0;

  let motdParts = parts.filter((p) => !/^[\d.]+$/.test(p));
  if (motdParts[0] && motdParts[0].length <= 3 && /^\d+§/.test(motdParts[0])) motdParts.shift();

  return {
    online: true,
    motd: stripColorCodes(motdParts.join('\n')) || 'No MOTD set',
    version: 'Legacy (1.6)',
    playersOnline,
    playersMax,
  };
}

async function fetchServerData(serverAddress, isBedrock) {
  const sources = [];

  if (isBedrock) {
    sources.push({
      name: 'mcsrvstat.us',
      url: `https://api.mcsrvstat.us/bedrock/3/${encodeURIComponent(serverAddress)}`,
      normalize: (data) => ({
        online: !!data?.online,
        motd: data?.motd?.clean?.join('\n') || 'No MOTD set',
        version: data?.version || 'Unknown',
        playersOnline: data?.players?.online ?? 0,
        playersMax: data?.players?.max ?? 0,
        playerList: data?.players?.list?.length ? data.players.list.join(', ') : 'None or Hidden',
      }),
    });
  } else {
    sources.push({
      name: 'local legacy ping',
      fetch: () => {
        const { host, port } = splitAddress(serverAddress);
        return pingLegacy(host, port);
      },
      normalize: parseLegacy,
    });
    sources.push({
      name: 'minetools.eu',
      url: (() => {
        const { host, port } = splitAddress(serverAddress);
        return `https://api.minetools.eu/ping/${encodeURIComponent(host)}/${port}`;
      })(),
      normalize: (data) => {
        if (!data || data.error) {
          throw new Error(data?.error || 'Empty response');
        }
        return {
          online: true,
          motd: stripColorCodes(data.description) || 'No MOTD set',
          version: data.version?.name || data.version || 'Unknown',
          playersOnline: data.players?.online ?? 0,
          playersMax: data.players?.max ?? 0,
          playerList: data.players?.sample?.length ? data.players.sample.map((p) => p.name || p).join(', ') : 'None or Hidden',
        };
      },
    });
  }

  let lastError = null;
  for (const source of sources) {
    try {
      let raw;
      if (source.fetch) {
        raw = await source.fetch();
      } else {
        raw = (await axios.get(source.url, { timeout: 10000 })).data;
      }
      const status = source.normalize(raw);
      return status;
    } catch (err) {
      lastError = err.message;
      console.error(`[${source.name}] Failed for ${serverAddress}: ${err.message}`);
    }
  }

  throw new Error(lastError || 'All status APIs failed');
}

async function fetchStatusEmbed() {
  const serverAddress = getFullServerAddress();
  const isBedrock = config.type?.toLowerCase() === 'bedrock';
  const iconUrl = getIconUrl(serverAddress, isBedrock);
  const startTime = Date.now();

  try {
    const status = await fetchServerData(serverAddress, isBedrock);
    const ping = Date.now() - startTime;

    if (!status.online) {
      return new EmbedBuilder()
        .setTitle('Minecraft Status')
        .setColor('#FF0000')
        .setThumbnail(iconUrl)
        .setDescription(`Last Updated <t:${Math.floor(Date.now() / 1000)}:f> `)
        .addFields(
          { name: '<:globe:1548402074360741958> Server Address', value: `\`${serverAddress}\``, inline: true },
          { name: '<:redcircle:1548402078643257496> Status', value: 'Offline', inline: true }
        );
    }

    let cleanMotd = status.motd;

    if (cleanMotd.length > 1024) cleanMotd = cleanMotd.substring(0, 1021) + '...';

    return new EmbedBuilder()
      .setTitle('Minecraft Status')
      .setColor('#00FF00')
      .setThumbnail(iconUrl)
      .setDescription(`Last Updated <t:${Math.floor(Date.now() / 1000)}:f> `)
      .addFields(
        { name: '<:greencircle:1548402079607951482> Status', value: 'Online', inline: true },
        { name: '<:people:1548402076298772560> Players Online', value: `**${status.playersOnline}** / **${status.playersMax}**`, inline: true },
        { name: '<:lightning:1548402072364257371> Latency', value: `${ping}ms`, inline: true },
        { name: '<:gear:1548402071362080848> Version', value: status.version, inline: true },
        { name: '<:scroll:1548402077460463626> MOTD', value: `\`\`\`\n${cleanMotd}\n\`\`\``, inline: false }
      );
  } catch (error) {
    console.error(`[API Error] No reliable status for ${serverAddress}:`, error.message);
    return null;
  }
}

function isStatusMessage(message) {
  if (message.author?.id !== client.user?.id) return false;
  const title = message.embeds?.[0]?.title;
  return (
    title === 'Minecraft Status' ||
    title === 'Server Offline' ||
    title === '<:cross:1548402073417293925> Server Offline' ||
    title === getFullServerAddress() ||
    title?.startsWith('<:controller:1548402075346542602> ')
  );
}

async function findStatusMessage(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    return messages.find((m) => isStatusMessage(m)) || null;
  } catch {
    return null;
  }
}

async function deleteOtherStatusMessages(channel, keepId) {
  const messages = await channel.messages.fetch({ limit: 50 });
  for (const message of messages.values()) {
    if (message.id === keepId) continue;
    if (isStatusMessage(message)) {
      await message.delete().catch(() => {});
    }
  }
}

async function updateStatusMessage() {
  try {
    const channel = await client.channels.fetch(config.channelId);
    if (!channel || !channel.isTextBased()) {
      console.error('Invalid channel ID or channel is not text-based.');
      return;
    }

    const embed = await fetchStatusEmbed();
    if (!embed) {
      console.log('Skipping update this cycle (no reliable API response). Keeping last status.');
      return;
    }

    if (statusMessage) {
      try {
        await deleteOtherStatusMessages(channel, statusMessage.id);
        await statusMessage.edit({ embeds: [embed] });
        return;
      } catch (err) {
        console.log('Status message missing or deleted. Searching channel...');
        statusMessage = null;
      }
    }

    statusMessage = await findStatusMessage(channel);
    if (statusMessage) {
      try {
        await deleteOtherStatusMessages(channel, statusMessage.id);
        await statusMessage.edit({ embeds: [embed] });
        return;
      } catch (err) {
        console.log('Found status message could not be edited. Sending new one...');
        statusMessage = null;
      }
    }

    await deleteOtherStatusMessages(channel);
    statusMessage = await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Failed to update status message:', error.message);
  }
}

// Modern Discord.js v14 event name to resolve deprecation warning
client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}! Starting status updates...`);
  statusMessage = null;
  updateStatusMessage();
  setInterval(updateStatusMessage, 30000);
});

client.login(config.token);