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
  PermissionFlagsBits,
} = require('discord.js');

const fs = require('fs');

// ─── Config ───────────────────────────────────────────────────────────────────

const LEAGUE_CHANNEL_ID    = '1494619413830172793'; // #league-host
const LEAGUES_ROLE_ID      = '1494657086309666866'; // @leagues (ping)
const LEAGUE_HOST_ROLE_ID  = '1494929242813890651'; // League Host (can host/cancel)
const INFO_CHANNEL_ID      = '1494631518373417000'; // #server-information

// ─── Database ─────────────────────────────────────────────────────────────────

const DB_PATH = './database.json';

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ leagues: {}, warns: {} }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return { leagues: {}, warns: {} };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return Math.random().toString(36).substring(2, 10);
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
    .setFooter({ text: `LOC Hosting  •  League ID: ${leagueId}` })
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

// ─── Bad words ────────────────────────────────────────────────────────────────

const BAD_WORDS = [
  'fuck', 'f u c k', 'f*ck', 'fck',
  'shit', 'sh*t',
  'bitch', 'b*tch', 'btch',
  'cunt',
  'dick',
  'pussy',
  'bastard',
  'whore',
  'slut',
  'nigga', 'nigger',
  'faggot', 'fag',
  'ass',
];

function containsBadWord(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  return BAD_WORDS.some(word => normalized.includes(word.replace(/\s+/g, '')));
}

function getTimeoutDuration(warns) {
  if (warns >= 30) return { ms: 20 * 24 * 60 * 60 * 1000, label: '20 day timeout' };
  if (warns >= 15) return { ms: 10 * 24 * 60 * 60 * 1000, label: '10 day timeout' };
  if (warns >= 10) return { ms:  3 * 24 * 60 * 60 * 1000, label: '3 day timeout'  };
  if (warns >=  5) return { ms:      24 * 60 * 60 * 1000, label: '24 hour timeout' };
  if (warns >=  1) return { ms:           30 * 60 * 1000, label: '30 minute timeout' };
  return null;
}

// ─── Client ───────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
});

// ─── Slash commands definition ────────────────────────────────────────────────

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
          opt.setName('id').setDescription('League ID to cancel').setRequired(true)
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
  if (interaction.isButton()) {
    await handleButton(interaction);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ── /league ──────────────────────────────────────────────────────────────

  if (commandName === 'league') {
    const sub = interaction.options.getSubcommand();

    // ── host ─────────────────────────────────────────────────────────────

    if (sub === 'host') {
      if (interaction.channelId !== LEAGUE_CHANNEL_ID) {
        return interaction.reply({
          content: `Leagues can only be hosted in <#${LEAGUE_CHANNEL_ID}>.`,
          ephemeral: true,
        });
      }

      if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE_ID)) {
        return interaction.reply({
          content: 'You do not have permission to host leagues.',
          ephemeral: true,
        });
      }

      const format = interaction.options.getString('format');
      const type   = interaction.options.getString('type');
      const perks  = interaction.options.getString('perks');
      const region = interaction.options.getString('region');
      const id     = generateId();
      const max    = maxPlayers(format);

      const db = loadDB();
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
    }

    // ── cancel ────────────────────────────────────────────────────────────

    if (sub === 'cancel') {
      if (!interaction.member.roles.cache.has(LEAGUE_HOST_ROLE_ID)) {
        return interaction.reply({
          content: 'You do not have permission to cancel leagues.',
          ephemeral: true,
        });
      }

      const id = interaction.options.getString('id');
      const db = loadDB();

      if (!db.leagues[id]) {
        return interaction.reply({
          content: `No active league found with ID: **${id}**`,
          ephemeral: true,
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
        ephemeral: true,
      });
    }
  }

  // ── /guidelines ──────────────────────────────────────────────────────────

  if (commandName === 'guidelines') {
    await interaction.deferReply({ ephemeral: true });

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
});

// ─── Button handler ───────────────────────────────────────────────────────────

async function handleButton(interaction) {
  if (!interaction.customId.startsWith('join_')) return;

  const leagueId = interaction.customId.slice(5);
  const db       = loadDB();
  const league   = db.leagues[leagueId];

  if (!league) {
    return interaction.reply({ content: 'This league no longer exists.', ephemeral: true });
  }

  if (league.status !== 'open') {
    return interaction.reply({ content: 'This league is no longer accepting players.', ephemeral: true });
  }

  if (league.players.includes(interaction.user.id)) {
    return interaction.reply({ content: 'You have already joined this league.', ephemeral: true });
  }

  league.players.push(interaction.user.id);
  const spots = league.maxPlayers - league.players.length;

  let hostUser = null;
  try { hostUser = await client.users.fetch(league.hostId); } catch {}

  const embed = buildLeagueEmbed(league, leagueId, hostUser);
  const row   = buildJoinButton(leagueId, spots === 0);

  await interaction.update({ embeds: [embed], components: [row] });
  saveDB(db);

  // ── League full: open private thread ─────────────────────────────────────

  if (spots === 0) {
    league.status = 'started';
    saveDB(db);

    try {
      const channel = await client.channels.fetch(league.channelId);
      const message = await channel.messages.fetch(league.messageId);

      const thread = await message.startThread({
        name:                `League ${leagueId} - ${league.type} ${league.format} [${league.region}]`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        type:                ChannelType.PrivateThread,
        invitable:           false,
      });

      for (const playerId of league.players) {
        try { await thread.members.add(playerId); } catch {}
      }

      const playerMentions = league.players.map(id => `<@${id}>`).join(', ');

      const startEmbed = new EmbedBuilder()
        .setTitle(`League ${leagueId} - All players confirmed`)
        .setDescription(
          `Format: **${league.format}**\nType: **${league.type}**\nPerks: **${league.perks}**\nRegion: **${league.region}**`
        )
        .addFields({ name: 'Players', value: playerMentions })
        .setColor(0x2b2d31)
        .setTimestamp();

      await thread.send({ embeds: [startEmbed] });

      league.threadId = thread.id;
      saveDB(db);
    } catch (err) {
      console.error('Thread creation error:', err);
    }
  }
}

// ─── Automod ──────────────────────────────────────────────────────────────────

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild)      return;

  if (!containsBadWord(message.content)) return;

  try { await message.delete(); } catch {}

  const db     = loadDB();
  if (!db.warns) db.warns = {};

  const userId = message.author.id;
  if (!db.warns[userId]) db.warns[userId] = 0;
  db.warns[userId]++;

  const warns     = db.warns[userId];
  const punishment = getTimeoutDuration(warns);

  if (warns >= 30) {
    db.warns[userId] = 0;
  }

  saveDB(db);

  if (punishment) {
    try {
      const member = await message.guild.members.fetch(userId);
      await member.timeout(punishment.ms, `Automod: Inappropriate language (warn ${warns})`);
    } catch {}
  }

  try {
    const warnEmbed = new EmbedBuilder()
      .setTitle('Automod Warning')
      .setDescription(
        `${message.author}, your message was removed for inappropriate language.\n\n` +
        `**Warn count:** ${warns >= 30 ? '30 (reset to 0)' : warns}/30\n` +
        (punishment ? `**Consequence:** ${punishment.label}` : '')
      )
      .setColor(0x2b2d31)
      .setTimestamp();

    await message.channel.send({ embeds: [warnEmbed] });
  } catch {}
});

// ─── Login ────────────────────────────────────────────────────────────────────

if (!process.env.DISCORD_TOKEN) {
  console.error('ERROR: No DISCORD_TOKEN environment variable set. Please add your bot token.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
