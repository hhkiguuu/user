require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const mongoose = require("mongoose");
mongoose.connect(process.env.MONGO_URI);

// ================= MODELS =================
const User = mongoose.model("User", new mongoose.Schema({
  discordId: String,
  swipebucks: { type: Number, default: 0 }
}));

const Username = mongoose.model("Username", new mongoose.Schema({
  name: { type: String, unique: true },
  ownerId: String,
  price: Number,
  forSale: { type: Boolean, default: false },
  frozen: { type: Boolean, default: false }
}));

const Trade = mongoose.model("Trade", new mongoose.Schema({
  from: String,
  to: String,
  name: String,
  status: { type: String, default: "pending" }
}));

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ================= IDS =================
const OWNER_ID = "1519064660501074133";
const ADMIN_ROLE = "1519756610287697920";

// ================= HELPERS =================
async function getUser(id) {
  return await User.findOneAndUpdate(
    { discordId: id },
    { discordId: id },
    { upsert: true, new: true }
  );
}

function isAdmin(member) {
  if (!member) return false;
  if (member.id === OWNER_ID) return true;
  if (member.roles?.cache?.has(ADMIN_ROLE)) return true;
  return false;
}

// ================= COMMANDS =================
const commands = [
  new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Trade a username")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User to trade with")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("name")
        .setDescription("Username to trade")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Admin panel")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// ================= READY =================
client.once("ready", async () => {
  console.log("💎 SWIPECORE TRADE + ADMIN ONLINE");

  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
});

// ================= TRADE COMMAND =================
client.on("interactionCreate", async (i) => {

  // ================= TRADE REQUEST =================
  if (i.commandName === "trade") {

    const target = i.options.getUser("user");
    const name = i.options.getString("name");

    const item = await Username.findOne({ name });

    if (!item)
      return i.reply("Username not found");

    if (item.ownerId !== i.user.id)
      return i.reply("You don't own this username");

    if (item.frozen)
      return i.reply("❄ This username is frozen");

    const trade = await Trade.create({
      from: i.user.id,
      to: target.id,
      name
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`trade_accept:${trade._id}`)
        .setLabel("Accept")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`trade_decline:${trade._id}`)
        .setLabel("Decline")
        .setStyle(ButtonStyle.Danger)
    );

    return i.reply({
      content: `🤝 Trade request sent to <@${target.id}>`,
      components: [row]
    });
  }

  // ================= ADMIN PANEL =================
  if (i.commandName === "admin") {

    if (!isAdmin(i.member))
      return i.reply({ content: "No permission", ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle("🛡 ADMIN PANEL")
      .setDescription("Trade & Username Control System");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("admin_stats")
        .setLabel("Stats")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("admin_frozen")
        .setLabel("Frozen List")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("admin_unfreeze")
        .setLabel("Unfreeze All")
        .setStyle(ButtonStyle.Success)
    );

    return i.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  // ================= BUTTONS =================
  if (!i.isButton()) return;

  // ================= TRADE ACCEPT =================
  if (i.customId.startsWith("trade_accept")) {

    const id = i.customId.split(":")[1];
    const trade = await Trade.findById(id);

    if (!trade) return;

    if (i.user.id !== trade.to)
      return i.reply({ content: "Not your trade", ephemeral: true });

    const item = await Username.findOne({ name: trade.name });

    if (!item) return;

    item.ownerId = trade.to;
    await item.save();

    trade.status = "accepted";
    await trade.save();

    return i.reply("✅ Trade accepted");
  }

  // ================= TRADE DECLINE =================
  if (i.customId.startsWith("trade_decline")) {

    const id = i.customId.split(":")[1];
    const trade = await Trade.findById(id);

    if (!trade) return;

    if (i.user.id !== trade.to)
      return i.reply({ content: "Not your trade", ephemeral: true });

    trade.status = "declined";
    await trade.save();

    return i.reply("❌ Trade declined");
  }

  // ================= ADMIN STATS =================
  if (i.customId === "admin_stats") {

    if (!isAdmin(i.member))
      return i.reply({ content: "No permission", ephemeral: true });

    const users = await User.countDocuments();
    const names = await Username.countDocuments();

    return i.reply({
      content: `👥 Users: ${users}\n🏷 Usernames: ${names}`,
      ephemeral: true
    });
  }

  // ================= ADMIN FROZEN =================
  if (i.customId === "admin_frozen") {

    if (!isAdmin(i.member))
      return i.reply({ content: "No permission", ephemeral: true });

    const frozen = await Username.find({ frozen: true });

    return i.reply({
      content: frozen.length
        ? frozen.map(x => `❄ ${x.name}`).join("\n")
        : "No frozen usernames",
      ephemeral: true
    });
  }

  // ================= ADMIN UNFREEZE =================
  if (i.customId === "admin_unfreeze") {

    if (!isAdmin(i.member))
      return i.reply({ content: "No permission", ephemeral: true });

    await Username.updateMany({}, { frozen: false });

    return i.reply({ content: "All usernames unfrozen", ephemeral: true });
  }
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
