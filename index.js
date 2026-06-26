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

// ================= DB =================
mongoose.connect(process.env.MONGO_URI);

// ================= MODELS =================
const User = mongoose.model("User", new mongoose.Schema({
  discordId: String,
  swipebucks: { type: Number, default: 0 },
  usernames: [String],
  lastDaily: Number,
  lastTrade: Number,
  lastClaim: Number
}));

const Username = mongoose.model("Username", new mongoose.Schema({
  name: { type: String, unique: true },
  ownerId: String,
  price: Number,
  locked: { type: Boolean, default: false }
}));

const Trade = mongoose.model("Trade", new mongoose.Schema({
  from: String,
  to: String,
  offer: String,
  request: String,
  status: { type: String, default: "pending" },
  createdAt: { type: Number, default: Date.now }
}));

const Auction = mongoose.model("Auction", new mongoose.Schema({
  item: String,
  sellerId: String,
  highestBid: { type: Number, default: 0 },
  highestBidder: String,
  endTime: Number,
  active: { type: Boolean, default: true }
}));

// ================= CLIENT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ================= ADMIN SYSTEM =================
const OWNER_ID = "1519064660501074133";
const ADMIN_ROLE = "1519756610287697920";

async function isAdmin(member) {
  if (!member) return false;
  if (member.id === OWNER_ID) return true;
  if (member.roles?.cache?.has(ADMIN_ROLE)) return true;
  return false;
}

// ================= COOLDOWNS (ANTI-SPAM) =================
const cooldowns = new Map();

function checkCooldown(userId, key, ms) {
  const now = Date.now();
  const id = `${userId}:${key}`;

  if (cooldowns.has(id)) {
    const last = cooldowns.get(id);
    if (now - last < ms) return false;
  }

  cooldowns.set(id, now);
  return true;
}

// ================= ANTI EXPLOIT VALUE SYSTEM =================
function getValue(name) {
  const len = name.length;

  if (len === 1) return 8000000;
  if (len === 2) return 2000000;
  if (len === 3) return 500000;
  if (len === 4) return 120000;

  let v = 5000;

  if (/^[a-z]+$/.test(name)) v += 100000;
  if (/[0-9]/.test(name)) v -= 30000;

  return v;
}

// ================= HELPERS =================
async function getUser(id) {
  return await User.findOneAndUpdate(
    { discordId: id },
    { discordId: id },
    { upsert: true, new: true }
  );
}

// ================= COMMANDS =================
const commands = [
  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("balance").setDescription("Check balance"),

  new SlashCommandBuilder().setName("daily").setDescription("Daily reward"),

  new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Trade system")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addStringOption(o => o.setName("offer").setRequired(true))
    .addStringOption(o => o.setName("request").setRequired(true)),

  new SlashCommandBuilder()
    .setName("auction")
    .setDescription("Create auction")
    .addStringOption(o => o.setName("item").setRequired(true))
    .addIntegerOption(o => o.setName("time").setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// ================= READY =================
client.once("ready", async () => {
  console.log("💎 SwipeCore Secure Online");

  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async (i) => {

  const u = await getUser(i.user.id);

  // ================= CLAIM (ANTI DUP + COOLDOWN) =================
  if (i.commandName === "claim") {

    if (!checkCooldown(i.user.id, "claim", 10000))
      return i.reply("⏳ Slow down (anti-exploit)");

    const name = i.options.getString("name");

    const exists = await Username.findOne({ name });
    if (exists) return i.reply(`❌ Owned by <@${exists.ownerId}>`);

    await Username.create({
      name,
      ownerId: i.user.id,
      price: getValue(name)
    });

    return i.reply(`✅ Claimed ${name}`);
  }

  // ================= BALANCE =================
  if (i.commandName === "balance") {
    return i.reply(`💰 ${u.swipebucks}`);
  }

  // ================= DAILY =================
  if (i.commandName === "daily") {

    if (!checkCooldown(i.user.id, "daily", 86400000))
      return i.reply("Already claimed");

    u.swipebucks += 1000;
    u.lastDaily = Date.now();

    await u.save();

    return i.reply("+1000 SwipeBucks");
  }

  // ================= TRADE (ANTI EXPLOIT) =================
  if (i.commandName === "trade") {

    if (!checkCooldown(i.user.id, "trade", 8000))
      return i.reply("⏳ Trade cooldown");

    const to = i.options.getUser("user");
    const offer = i.options.getString("offer");
    const request = i.options.getString("request");

    const trade = await Trade.create({
      from: i.user.id,
      to: to.id,
      offer,
      request
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`accept:${trade._id}`)
        .setLabel("Accept")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`decline:${trade._id}`)
        .setLabel("Decline")
        .setStyle(ButtonStyle.Danger)
    );

    return i.reply({
      content: `🤝 Trade created`,
      components: [row]
    });
  }

  // ================= AUCTION =================
  if (i.commandName === "auction") {

    const item = i.options.getString("item");
    const time = i.options.getInteger("time");

    await Auction.create({
      item,
      sellerId: i.user.id,
      endTime: Date.now() + time * 60000
    });

    return i.reply(`🏷️ Auction started`);
  }
});

// ================= BUTTONS (TRADE SECURITY) =================
client.on("interactionCreate", async (i) => {

  if (!i.isButton()) return;

  const [action, id] = i.customId.split(":");

  const trade = await Trade.findById(id);
  if (!trade) return;

  const from = await getUser(trade.from);
  const to = await getUser(trade.to);

  // ================= ACCEPT =================
  if (action === "accept") {

    if (i.user.id !== trade.to)
      return i.reply({ content: "Not your trade", ephemeral: true });

    // prevent double-accept exploit
    if (trade.status !== "pending")
      return i.reply({ content: "Already processed", ephemeral: true });

    trade.status = "accepted";

    await from.save();
    await to.save();
    await trade.save();

    return i.reply("✅ Accepted");
  }

  // ================= DECLINE =================
  if (action === "decline") {

    if (i.user.id !== trade.to)
      return i.reply({ content: "Not your trade", ephemeral: true });

    if (trade.status !== "pending")
      return i.reply({ content: "Already processed", ephemeral: true });

    trade.status = "declined";
    await trade.save();

    return i.reply("❌ Declined");
  }
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
