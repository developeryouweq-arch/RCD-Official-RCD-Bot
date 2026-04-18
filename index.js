const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ThreadAutoArchiveDuration,
} = require('discord.js');

const fs = require('fs');

// ─── Config ───────────────────────────────────────────────────────────────────

const LEAGUE_CHANNEL_ID   = '1494619413830172793'; // #league-host
const LEAGUES_ROLE_ID     = '1494657086309666866'; // @leagues ping
const LEAGUE_HOST_ROLE_ID = '1494929242813890651'; // League Host role
const INFO_CHANNEL_ID     = '1494631518373417000'; // #server-information

// ─── Database ─────────────────────────────────────────────────────────────────

const DB_PATH = './database.json';

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ leagues: {}, warns: {}, leagueCounter: 0 }, null, 2));
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    if (!data.leagues)       data.leagues       = {};
    if (!data.warns)         data.warns         = {};
    if (!data.leagueCounter) data.leagueCounter = 0;
    return data;
  } catch {
    return { leagues: {}, warns: {}, leagueCounter: 0 };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextLeagueId(db) {
  db.leagueCounter = (db.leagueCounter || 0) + 1;
  return `LG-${String(db.leagueCounter).padStart(4, '0')}`;
}

function maxPlayers(format) {
  return { '2v2': 4, '3v3': 6, '4v4': 8 }[format] || 6;
}

function buildLeagueEmbed(league, leagueId, hostUser) {
  const spots = league.maxPlayers - league.players.length;
  const embed = new EmbedBuilder()
    .setTitle(`${league.type} ${league.perks} - ${league.format} (${league.region.toUpperCase()})`)
    .setDescription(
      spots > 0
        ? `Hosting a game. Need ${spots} more player${spots !== 1 ? 's' : ''} to join.`
        : 'All spots are filled. The game is starting.'
    )
    .addFields({ name: 'Hosted by', value: league.hostTag, inline: false })
    .setFooter({ text: `RCD Hosting  •  League ID: ${leagueId}` })
    .setTimestamp()
    .setColor(0x2b2d31);

  if (hostUser) embed.setThumbnail(hostUser.displayAvatarURL({ dynamic: true }));
  return embed;
}

function buildJoinButton(leagueId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join_${leagueId}`)
      .setLabel('Join Game')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

function buildThreadEmbed(leagueId, league) {
  return new EmbedBuilder()
    .setTitle('Private League Thread')
    .setDescription(
      `This private thread is for league \`${leagueId}\`. Players who join the league will be added here automatically.`
    )
    .addFields(
      { name: 'Join Command',   value: `\`/league join league_id:${leagueId}\``,   inline: false },
      { name: 'Cancel Command', value: `\`/league cancel league_id:${leagueId}\``, inline: false }
    )
    .setColor(0x2b2d31);
}


// ─── Client ───────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildWebhooks,
  ],
});

// ─── Slash commands ───────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('league')
    .setDescription('League management')
    .addSubcommand(sub =>
      sub
        .setName('host')
        .setDescription('Host a new league')
        .addStringOption(opt =>
          opt.setName('format').setDescription('Match format').setRequired(true)
            .addChoices(
              { name: '2v2', value: '2v2' },
              { name: '3v3', value: '3v3' },
              { name: '4v4', value: '4v4' },
            )
        )
        .addStringOption(opt =>
          opt.setName('type').setDescription('Match type').setRequired(true)
            .addChoices(
              { name: 'Swift Game', value: 'Swift Game' },
              { name: 'War Game',   value: 'War Game'   },
            )
        )
        .addStringOption(opt =>
          opt.setName('perks').setDescription('Match perks').setRequired(true)
            .addChoices(
              { name: 'Perks',    value: 'Perks'    },
              { name: 'No Perks', value: 'No Perks' },
            )
        )
        .addStringOption(opt =>
          opt.setName('region').setDescription('Region').setRequired(true)
            .addChoices(
              { name: 'Europe',        value: 'Europe'        },
              { name: 'Asia',          value: 'Asia'          },
              { name: 'North America', value: 'North America' },
              { name: 'South America', value: 'South America' },
              { name: 'Oceania',       value: 'Oceania'       },
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('cancel')
        .setDescription('Cancel an active league')
        .addStringOption(opt =>
          opt.setName('id').setDescription('League ID to cancel (e.g. LG-0001)').setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('guidelines')
    .setDescription('Post the server guidelines to the info channel'),
];

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once('ready', async () => {
  console.log(`Online: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands.map(c => c.toJSON()),
    });
    console.log('Slash commands registered globally.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

// ─── Interaction handler ──────────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // ── /league ────────────────────────────────────────────────────────────

    if (commandName === 'league') {
      const sub = interaction.options.getSubcommand();

      // ── host ──────────────────────────────────────────────────────────

      if (sub === 'host') {
        if (interaction.channelId !== LEAGUE_CHANNEL_ID) {
          return interaction.reply({
            content: `Leagues can only be hosted in <#${LEAGUE_CHANNEL_ID}>.`,
            flags: 64,
          });
        }

        if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE_ID)) {
          return interaction.reply({
            content: 'You do not have permission to host leagues.',
            flags: 64,
          });
        }

        const format = interaction.options.getString('format');
        const type   = interaction.options.getString('type');
        const perks  = interaction.options.getString('perks');
        const region = interaction.options.getString('region');

        const db  = loadDB();
        const id  = nextLeagueId(db);
        const max = maxPlayers(format);

        db.leagues[id] = {
          id,
          hostId:     interaction.user.id,
          hostTag:    interaction.user.username,
          format,
          type,
          perks,
          region,
          players:    [interaction.user.id],
          maxPlayers: max,
          status:     'open',
          channelId:  interaction.channelId,
          guildId:    interaction.guildId,
          messageId:  null,
          threadId:   null,
        };
        saveDB(db);

        const embed = buildLeagueEmbed(db.leagues[id], id, interaction.user);
        const row   = buildJoinButton(id);

        const msg = await interaction.reply({
          content:    `<@&${LEAGUES_ROLE_ID}>`,
          embeds:     [embed],
          components: [row],
          fetchReply: true,
        });

        db.leagues[id].messageId = msg.id;
        saveDB(db);

        // Create private thread immediately on the league channel
        try {
          const leagueChannel = await client.channels.fetch(interaction.channelId);
          const thread = await leagueChannel.threads.create({
            name:                `${id} ${format} ${type}`,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
            type:                ChannelType.PrivateThread,
            invitable:           false,
            reason:              `League ${id} private thread`,
          });

          await thread.members.add(interaction.user.id);
          await thread.send({
            content:  `<@${interaction.user.id}>`,
            embeds:   [buildThreadEmbed(id, db.leagues[id])],
          });

          db.leagues[id].threadId = thread.id;
          saveDB(db);
          console.log(`Thread created for league ${id}: ${thread.id}`);
        } catch (threadErr) {
          console.error(`Thread creation failed for ${id}:`, threadErr.message);
        }
      }

      // ── cancel ────────────────────────────────────────────────────────

      if (sub === 'cancel') {
        if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE_ID)) {
          return interaction.reply({
            content: 'You do not have permission to cancel leagues.',
            flags: 64,
          });
        }

        const id = interaction.options.getString('id').toUpperCase();
        const db = loadDB();

        if (!db.leagues[id]) {
          return interaction.reply({
            content: `No active league found with ID: **${id}**`,
            flags: 64,
          });
        }

        const league = db.leagues[id];

        try {
          const ch  = await client.channels.fetch(league.channelId);
          const msg = await ch.messages.fetch(league.messageId);
          await msg.delete();
        } catch {}

        if (league.threadId) {
          try {
            const thread = await client.channels.fetch(league.threadId);
            await thread.send('This league has been cancelled by a host.');
            await thread.setArchived(true);
          } catch {}
        }

        delete db.leagues[id];
        saveDB(db);

        return interaction.reply({
          content: `League **${id}** has been cancelled and removed.`,
          flags: 64,
        });
      }
    }

    // ── /guidelines ────────────────────────────────────────────────────────

    if (commandName === 'guidelines') {
      await interaction.deferReply({ flags: 64 });

      try {
        const channel = await client.channels.fetch(INFO_CHANNEL_ID);

        const sections = [
          {
            title: 'Community Guidelines',
            body: "We are committed to maintaining a welcoming and good environment for everyone. Any behavior that includes toxicity or which affects other members negatively will not be tolerated. Appropriate action will be taken to make sure that our community and environmental standards are positively upheld.\n\nPlease make sure you're following Discord Terms of Service and Community Guidelines at all times.\n\nhttps://discord.com/terms\nhttps://discord.com/guidelines",
          },
          {
            title: 'Harassment & Toxicity',
            body: "» We do not tolerate hate speech, racism, or targeted harassment. Engaging in toxic behavior or intentionally disrupting the peace of the community will lead to mutes, kicks, or bans at the discretion of the staff team. Respecting boundaries is a requirement for membership.",
          },
          {
            title: 'Identity Protection & Privacy',
            body: "» The disclosure of any private, real-world information belonging to another member is an unpardonable offense. Whether via public channels or private messages, any attempt to dox, threaten exposure, or distribute leaked private media will result in an immediate permanent blacklist. We prioritize the safety of our members above all else.",
          },
          {
            title: 'NSFW & Legal Compliance',
            body: "» All adult-oriented discussions and media are strictly prohibited from this server. Any member caught distributing prohibited, illegal, or NSFW content will be removed and reported to the proper legal authorities without warning.",
          },
          {
            title: 'System Integrity & Anti-Exploitation',
            body: "» Any attempt to disrupt server operations through the use of exploits, scripts, or malicious bot commands is strictly forbidden. We maintain a high-security environment. Those found attempting to bypass slow modes, crack roles, or gain unfair advantages in server events will face immediate disciplinary termination to ensure a level playing field for all.",
          },
          {
            title: 'Predatory Behavior & Harassment',
            body: "» This server operates on a policy of mutual consent. Unsolicited sexual DMs, persistent harassment, or the use of hate speech and slurs will not be tolerated. Our moderation team utilizes advanced logging to track behavioral patterns. If your presence is deemed toxic or predatory toward the well-being of the community, you will be removed.",
          },
          {
            title: 'Commercial Neutrality & Anti-Spam',
            body: "» All forms of unauthorized solicitation including DM advertising for sales, promoting external platforms, or sharing scam links are banned. This server is not a marketplace for unverified sellers. Spamming of any kind, whether text or emoji-based, will result in automated mutes. DM spamming to join other servers is strictly prohibited and will result in a warning.",
          },
          {
            title: 'Administrative Finality',
            body: "» The Administration and Moderation teams serve as the final arbiters of these rules. We reserve the right to remove any individual whose conduct is deemed a liability to the server's longevity or safety. Arguing with staff regarding enforcement in public channels is considered a disruption and will be handled accordingly.",
          },
          {
            title: 'Account Responsibility',
            body: "» You are the sole custodian of your Discord account. Any rule violations committed by your account, regardless of who was at the keyboard, are your responsibility. Any attempt to circumvent a punishment via alternate accounts will result in a permanent hardware and IP-based ban.",
          },
        ];

        for (const section of sections) {
          const embed = new EmbedBuilder()
            .setTitle(section.title)
            .setDescription(section.body)
            .setColor(0x2b2d31);
          await channel.send({ embeds: [embed] });
        }

        await interaction.editReply({ content: 'Guidelines posted successfully.' });
      } catch (err) {
        console.error('Guidelines error:', err);
        await interaction.editReply({ content: 'Failed to post guidelines. Check bot permissions.' });
      }
    }

  } catch (err) {
    console.error('Interaction error:', err);
  }
});

// ─── Button handler ───────────────────────────────────────────────────────────

async function handleButton(interaction) {
  if (!interaction.customId.startsWith('join_')) return;

  const leagueId = interaction.customId.slice(5);
  const db       = loadDB();
  const league   = db.leagues[leagueId];

  if (!league) {
    return interaction.reply({ content: 'This league no longer exists.', flags: 64 });
  }

  if (league.status !== 'open') {
    return interaction.reply({ content: 'This league is no longer accepting players.', flags: 64 });
  }

  if (league.players.includes(interaction.user.id)) {
    return interaction.reply({ content: 'You have already joined this league.', flags: 64 });
  }

  league.players.push(interaction.user.id);
  const spots = league.maxPlayers - league.players.length;

  if (spots === 0) league.status = 'started';

  let hostUser = null;
  try { hostUser = await client.users.fetch(league.hostId); } catch {}

  const embed = buildLeagueEmbed(league, leagueId, hostUser);
  const row   = buildJoinButton(leagueId, spots === 0);

  await interaction.update({ embeds: [embed], components: [row] });
  saveDB(db);

  // Add the new player to the private thread
  if (league.threadId) {
    try {
      const thread = await client.channels.fetch(league.threadId);
      await thread.members.add(interaction.user.id);
    } catch (err) {
      console.error('Failed to add player to thread:', err.message);
    }
  }
}


// ─── Anti-Nuke ────────────────────────────────────────────────────────────────

const nukeTracker = new Map();
const NUKE_WINDOW_MS  = 10_000;
const NUKE_THRESHOLDS = {
  channelDelete: 3,
  roleDelete:    3,
  ban:           3,
  kick:          3,
  webhookCreate: 3,
  botAdd:        2,
};

function trackNukeAction(userId, action) {
  const now = Date.now();
  const key  = `${userId}:${action}`;
  if (!nukeTracker.has(key)) nukeTracker.set(key, []);
  const timestamps = nukeTracker.get(key).filter(t => now - t < NUKE_WINDOW_MS);
  timestamps.push(now);
  nukeTracker.set(key, timestamps);
  return timestamps.length;
}

async function nukeResponse(guild, userId, reason) {
  console.warn(`[Anti-Nuke] ${reason} — User: ${userId}`);
  try {
    const member = await guild.members.fetch(userId);
    if (!member) return;
    if (member.bannable) {
      await guild.members.ban(userId, { reason: `Anti-Nuke: ${reason}` });
      console.warn(`[Anti-Nuke] Banned ${userId}`);
    } else {
      await member.timeout(28 * 24 * 60 * 60 * 1000, `Anti-Nuke: ${reason}`);
      console.warn(`[Anti-Nuke] Timed out ${userId} (28 days)`);
    }
  } catch (err) {
    console.error('[Anti-Nuke] Failed to action user:', err.message);
  }
}

async function getAuditEntry(guild, actionType) {
  try {
    const logs  = await guild.fetchAuditLogs({ limit: 1, type: actionType });
    const entry = logs.entries.first();
    if (!entry) return null;
    if (Date.now() - entry.createdTimestamp > 5000) return null;
    if (entry.executor?.bot) return null;
    return entry;
  } catch {
    return null;
  }
}

client.on('channelDelete', async channel => {
  if (!channel.guild) return;
  const entry = await getAuditEntry(channel.guild, 12);
  if (!entry) return;
  const count = trackNukeAction(entry.executor.id, 'channelDelete');
  if (count >= NUKE_THRESHOLDS.channelDelete)
    await nukeResponse(channel.guild, entry.executor.id, `Mass channel deletion (${count} in 10s)`);
});

client.on('roleDelete', async role => {
  if (!role.guild) return;
  const entry = await getAuditEntry(role.guild, 32);
  if (!entry) return;
  const count = trackNukeAction(entry.executor.id, 'roleDelete');
  if (count >= NUKE_THRESHOLDS.roleDelete)
    await nukeResponse(role.guild, entry.executor.id, `Mass role deletion (${count} in 10s)`);
});

client.on('guildBanAdd', async ban => {
  const entry = await getAuditEntry(ban.guild, 22);
  if (!entry) return;
  const count = trackNukeAction(entry.executor.id, 'ban');
  if (count >= NUKE_THRESHOLDS.ban)
    await nukeResponse(ban.guild, entry.executor.id, `Mass ban (${count} in 10s)`);
});

client.on('guildMemberRemove', async member => {
  const entry = await getAuditEntry(member.guild, 20);
  if (!entry || entry.target?.id !== member.id) return;
  if (Date.now() - entry.createdTimestamp > 3000) return;
  const count = trackNukeAction(entry.executor.id, 'kick');
  if (count >= NUKE_THRESHOLDS.kick)
    await nukeResponse(member.guild, entry.executor.id, `Mass kick (${count} in 10s)`);
});

client.on('webhookUpdate', async channel => {
  if (!channel.guild) return;
  const entry = await getAuditEntry(channel.guild, 50);
  if (!entry) return;
  const count = trackNukeAction(entry.executor.id, 'webhookCreate');
  if (count >= NUKE_THRESHOLDS.webhookCreate)
    await nukeResponse(channel.guild, entry.executor.id, `Mass webhook creation (${count} in 10s)`);
});

client.on('guildMemberAdd', async member => {
  if (!member.user.bot) return;
  const entry = await getAuditEntry(member.guild, 28);
  if (!entry) return;
  const count = trackNukeAction(entry.executor.id, 'botAdd');
  if (count >= NUKE_THRESHOLDS.botAdd)
    await nukeResponse(member.guild, entry.executor.id, `Mass bot addition (${count} in 10s)`);
});

// ─── Login ────────────────────────────────────────────────────────────────────

if (!process.env.DISCORD_TOKEN) {
  console.error('ERROR: No DISCORD_TOKEN environment variable set.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
