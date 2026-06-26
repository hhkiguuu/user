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
  lastDaily: Number
}));

const Username = mongoose.model("Username", new mongoose.Schema({
  name: { type: String, unique: true },
  ownerId: String,
  price: Number
}));

const Trade = mongoose.model("Trade", new mongoose.Schema({
  from: String,
  to: String,
  offer: String,
  request: String,
  status: { type: String, default: "pending" }
}));

const Auction = mongoose.model("Auction", new mongoose.Schema({
  item: String,
  sellerId: String,
  highestBid: { type: Number, default: 0 },
  highestBidder: String,
  endTime: Number,
  active: { type: Boolean, default: true }
}));

const Inbox = mongoose.model("Inbox", new mongoose.Schema({
  userId: String,
  message: String,
  type: String,
  read: { type: Boolean, default: false }
}));

// ================= CLIENT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ================= HELPERS =================
async function getUser(id) {
  return await User.findOneAndUpdate(
    { discordId: id },
    { discordId: id },
    { upsert: true, new: true }
  );
}

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

async function notify(userId, msg, type = "system") {
  await Inbox.create({ userId, message: msg, type });
}

// ================= COMMANDS =================
const commands = [
  new SlashCommandBuilder().setName("claim").setDescription("Claim username"),
  new SlashCommandBuilder().setName("balance").setDescription("Balance"),
  new SlashCommandBuilder().setName("daily").setDescription("Daily reward"),
  new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Trade user/currency")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption(o => o.setName("offer").setDescription("Offer").setRequired(true))
    .addStringOption(o => o.setName("request").setDescription("Request").setRequired(true)),
  new SlashCommandBuilder()
    .setName("auction")
    .setDescription("Start auction")
    .addStringOption(o => o.setName("item").setRequired(true))
    .addIntegerOption(o => o.setName("time").setRequired(true)),
  new SlashCommandBuilder().setName("market").setDescription("Market"),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Leaderboard")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// ================= READY =================
client.once("ready", async () => {
  console.log("💎 SWIPECORE FINAL ONLINE");

  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async (i) => {

  const u = await getUser(i.user.id);

  // ================= CLAIM =================
  if (i.commandName === "claim") {

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

    if (Date.now() - (u.lastDaily || 0) < 86400000)
      return i.reply("Already claimed");

    u.swipebucks += 1000;
    u.lastDaily = Date.now();

    await u.save();

    return i.reply("+1000 SwipeBucks");
  }

  // ================= TRADE =================
  if (i.commandName === "trade") {

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
      content: `🤝 Trade from <@${i.user.id}> to <@${to.id}>`,
      components: [row]
    });
  }

  // ================= AUCTION =================
  if (i.commandName === "auction") {

    const item = i.options.getString("item");
    const time = i.options.getInteger("time");

    const auction = await Auction.create({
      item,
      sellerId: i.user.id,
      endTime: Date.now() + time * 60000
    });

    return i.reply(`🏷️ Auction started for ${item}`);
  }

  // ================= MARKET =================
  if (i.commandName === "market") {

    const items = await Username.find().limit(10);

    const embed = new EmbedBuilder().setTitle("🛒 Market");

    for (const x of items) {
      embed.addFields({
        name: x.name,
        value: `💰 ${x.price} | 👤 <@${x.ownerId}>`
      });
    }

    return i.reply({ embeds: [embed] });
  }

  // ================= LEADERBOARD =================
  if (i.commandName === "leaderboard") {

    const users = await User.find().sort({ swipebucks: -1 }).limit(10);

    const embed = new EmbedBuilder().setTitle("🏆 Rich List");

    users.forEach(x => {
      embed.addFields({
        name: x.discordId,
        value: `${x.swipebucks}`
      });
    });

    return i.reply({ embeds: [embed] });
  }
});

// ================= BUTTONS =================
client.on("interactionCreate", async (i) => {

  if (!i.isButton()) return;

  const [action, id] = i.customId.split(":");

  const trade = await Trade.findById(id);
  if (!trade) return;

  const from = await getUser(trade.from);
  const to = await getUser(trade.to);

  if (action === "accept") {

    if (i.user.id !== trade.to)
      return i.reply({ content: "Not yours", ephemeral: true });

    to.swipebucks += 100;
    from.swipebucks += 100;

    trade.status = "accepted";

    await from.save();
    await to.save();
    await trade.save();

    await notify(trade.from, "Trade accepted", "trade");

    return i.reply("✅ Accepted");
  }

  if (action === "decline") {

    trade.status = "declined";
    await trade.save();

    return i.reply("❌ Declined");
  }
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
