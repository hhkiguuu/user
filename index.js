require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require("discord.js");

const mongoose = require("mongoose");
mongoose.connect(process.env.MONGO_URI);

// ================= CONFIG =================
const OWNER_ID = "1519064660501074133";
const ADMIN_ROLE = "1519756610287697920";

// ================= CLIENT =================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ================= ECONOMY STATE =================
let MULTIPLIER = 1;

// ================= MODELS =================
const User = mongoose.model("User", new mongoose.Schema({
  discordId: String,
  balance: { type: Number, default: 1000 }
}));

const Username = mongoose.model("Username", new mongoose.Schema({
  name: { type: String, unique: true },
  ownerId: String,
  value: Number,
  rarity: String,
  forSale: { type: Boolean, default: false },
  price: Number,
  frozen: { type: Boolean, default: false },
  locked: { type: Boolean, default: false }
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
  endsAt: Number,
  active: { type: Boolean, default: true }
}));

const Audit = mongoose.model("Audit", new mongoose.Schema({
  action: String,
  by: String,
  target: String,
  time: { type: Date, default: Date.now }
}));

// ================= HELPERS =================
async function getUser(id) {
  return await User.findOneAndUpdate(
    { discordId: id },
    { discordId: id },
    { upsert: true, new: true }
  );
}

function isAdmin(member) {
  return member?.id === OWNER_ID || member?.roles?.cache?.has(ADMIN_ROLE);
}

function rarity(name) {
  if (name.length === 1) return "MYTHIC";
  if (name.length === 2) return "LEGENDARY";
  if (name.length === 3) return "EPIC";
  if (name.length === 4) return "RARE";
  return "COMMON";
}

function value(name) {
  let v =
    name.length === 1 ? 10000000 :
    name.length === 2 ? 2000000 :
    name.length === 3 ? 500000 :
    name.length === 4 ? 120000 :
    5000;

  return Math.floor(v * MULTIPLIER);
}

async function log(action, by, target = "none") {
  await Audit.create({ action, by, target });
}

// ================= COMMANDS (FIXED) =================
const commands = [
  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim a username")
    .addStringOption(o => o.setName("name").setDescription("username").setRequired(true)),

  new SlashCommandBuilder()
    .setName("users")
    .setDescription("View your usernames"),

  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your balance"),

  new SlashCommandBuilder()
    .setName("market")
    .setDescription("View marketplace"),

  new SlashCommandBuilder()
    .setName("sell")
    .setDescription("Sell a username")
    .addStringOption(o => o.setName("name").setDescription("name").setRequired(true))
    .addIntegerOption(o => o.setName("price").setDescription("price").setRequired(true)),

  new SlashCommandBuilder()
    .setName("buy")
    .setDescription("Buy a username")
    .addStringOption(o => o.setName("name").setDescription("name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("Open inventory UI"),

  new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Start escrow trade")
    .addUserOption(o => o.setName("user").setDescription("user").setRequired(true))
    .addStringOption(o => o.setName("offer").setDescription("offer").setRequired(true))
    .addStringOption(o => o.setName("request").setDescription("request").setRequired(true)),

  new SlashCommandBuilder()
    .setName("auction")
    .setDescription("Start auction")
    .addStringOption(o => o.setName("item").setDescription("item").setRequired(true))
    .addIntegerOption(o => o.setName("time").setDescription("minutes").setRequired(true)),

  new SlashCommandBuilder()
    .setName("bid")
    .setDescription("Place bid")
    .addStringOption(o => o.setName("item").setDescription("item").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("amount").setRequired(true)),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top users"),

  new SlashCommandBuilder()
    .setName("addcurrency")
    .setDescription("Add money")
    .addUserOption(o => o.setName("user").setDescription("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("amount").setRequired(true)),

  new SlashCommandBuilder()
    .setName("removecurrency")
    .setDescription("Remove money")
    .addUserOption(o => o.setName("user").setDescription("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("amount").setRequired(true)),

  new SlashCommandBuilder()
    .setName("freeze")
    .setDescription("Freeze username")
    .addStringOption(o => o.setName("name").setDescription("name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("unfreeze")
    .setDescription("Unfreeze username")
    .addStringOption(o => o.setName("name").setDescription("name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("revoke")
    .setDescription("Delete username")
    .addStringOption(o => o.setName("name").setDescription("name").setRequired(true))
].map(c => c.toJSON());

// ================= REST =================
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// ================= READY =================
client.once("ready", async () => {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log("ONLINE");
});

// ================= MAIN =================
client.on("interactionCreate", async (i) => {

  if (!i.isChatInputCommand()) return;

  const u = await getUser(i.user.id);

  // ===== CLAIM =====
  if (i.commandName === "claim") {
    const name = i.options.getString("name");

    const exists = await Username.findOne({ name });
    if (exists) return i.reply("Taken");

    await Username.create({
      name,
      ownerId: i.user.id,
      value: value(name),
      rarity: rarity(name)
    });

    await log("CLAIM", i.user.id, name);
    return i.reply(`✅ Claimed ${name}`);
  }

  // ===== USERS =====
  if (i.commandName === "users") {
    const items = await Username.find({ ownerId: i.user.id });

    const menu = new StringSelectMenuBuilder()
      .setCustomId("inv")
      .setPlaceholder("Inventory")
      .addOptions(items.map(x => ({
        label: x.name,
        value: x.name,
        description: `${x.rarity} | ${x.value}`
      })));

    return i.reply({
      content: "📦 Inventory",
      components: [new ActionRowBuilder().addComponents(menu)]
    });
  }

  // ===== BALANCE =====
  if (i.commandName === "balance") {
    return i.reply(`💰 ${u.balance}`);
  }

  // ===== MARKET =====
  if (i.commandName === "market") {
    const items = await Username.find({ forSale: true });

    const embed = new EmbedBuilder()
      .setTitle("🏪 Market")
      .setDescription(items.map(x => `${x.name} - ${x.price}`).join("\n") || "Empty");

    return i.reply({ embeds: [embed] });
  }

  // ===== SELL =====
  if (i.commandName === "sell") {
    const name = i.options.getString("name");
    const price = i.options.getInteger("price");

    const item = await Username.findOne({ name, ownerId: i.user.id });
    if (!item || item.frozen) return i.reply("Invalid");

    item.forSale = true;
    item.price = price;
    await item.save();

    await log("SELL", i.user.id, name);
    return i.reply("Listed");
  }

  // ===== BUY =====
  if (i.commandName === "buy") {
    const name = i.options.getString("name");

    const item = await Username.findOne({ name, forSale: true });
    if (!item) return i.reply("Not found");

    item.ownerId = i.user.id;
    item.forSale = false;
    await item.save();

    await log("BUY", i.user.id, name);
    return i.reply("Bought");
  }

  // ===== LEADERBOARD =====
  if (i.commandName === "leaderboard") {
    const top = await Username.find().sort({ value: -1 }).limit(10);

    return i.reply(
      top.map((x, i) => `#${i + 1} ${x.name} - ${x.value}`).join("\n")
    );
  }

  // ===== ADMIN =====
  if (!isAdmin(i.member)) return;

  if (i.commandName === "addcurrency") {
    const user = i.options.getUser("user");
    const amt = i.options.getInteger("amount");

    const d = await getUser(user.id);
    d.balance += amt;
    await d.save();

    return i.reply("Added");
  }

  if (i.commandName === "removecurrency") {
    const user = i.options.getUser("user");
    const amt = i.options.getInteger("amount");

    const d = await getUser(user.id);
    d.balance -= amt;
    await d.save();

    return i.reply("Removed");
  }

  if (i.commandName === "freeze") {
    const x = await Username.findOne({ name: i.options.getString("name") });
    x.frozen = true;
    await x.save();
    return i.reply("Frozen");
  }

  if (i.commandName === "unfreeze") {
    const x = await Username.findOne({ name: i.options.getString("name") });
    x.frozen = false;
    await x.save();
    return i.reply("Unfrozen");
  }

  if (i.commandName === "revoke") {
    const name = i.options.getString("name");
    await Username.deleteOne({ name });
    return i.reply("Deleted");
  }
});

client.login(process.env.TOKEN);
