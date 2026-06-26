require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const mongoose = require("mongoose");
mongoose.connect(process.env.MONGO_URI);

// ================= CONFIG =================
const OWNER_ID = "1519064660501074133";
const ADMIN_ROLE = "1519756610287697920";

let GLOBAL_MULTIPLIER = 1;

// ================= PRECLAIMED =================
const PRECLAIMED = [
  { name: "admin", ownerId: OWNER_ID },
  { name: "owner", ownerId: OWNER_ID },
  { name: "system", ownerId: OWNER_ID }
];

// ================= MODELS =================
const User = mongoose.model("User", new mongoose.Schema({
  discordId: String,
  balance: { type: Number, default: 1000 },
  tradeBanned: { type: Boolean, default: false },
  marketBanned: { type: Boolean, default: false }
}));

const Username = mongoose.model("Username", new mongoose.Schema({
  name: { type: String, unique: true },
  ownerId: String,
  value: Number,
  rarity: String,
  frozen: { type: Boolean, default: false },
  locked: { type: Boolean, default: false },
  forSale: { type: Boolean, default: false },
  price: Number
}));

const Trade = mongoose.model("Trade", new mongoose.Schema({
  from: String,
  to: String,
  items: [String],
  status: { type: String, default: "pending" }
}));

const Auction = mongoose.model("Auction", new mongoose.Schema({
  item: String,
  highestBid: { type: Number, default: 0 },
  highestBidder: String,
  endsAt: Number,
  active: { type: Boolean, default: true }
}));

const Log = mongoose.model("Log", new mongoose.Schema({
  type: String,
  data: Object,
  time: { type: Date, default: Date.now }
}));

const AdminLog = mongoose.model("AdminLog", new mongoose.Schema({
  adminId: String,
  action: String,
  target: String,
  meta: Object,
  time: { type: Date, default: Date.now }
}));

// ================= CLIENT =================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ================= HELPERS =================
function isAdmin(member) {
  return member?.id === OWNER_ID || member?.roles?.cache?.has(ADMIN_ROLE);
}

async function getUser(id) {
  return await User.findOneAndUpdate(
    { discordId: id },
    { discordId: id },
    { upsert: true, new: true }
  );
}

function rarity(name) {
  if (name.length === 1) return "mythic";
  if (name.length === 2) return "legendary";
  if (name.length === 3) return "epic";
  if (name.length === 4) return "rare";
  return "common";
}

function value(name) {
  let base =
    name.length === 1 ? 10000000 :
    name.length === 2 ? 2500000 :
    name.length === 3 ? 600000 :
    name.length === 4 ? 150000 :
    5000;

  return Math.floor(base * GLOBAL_MULTIPLIER);
}

// ================= ECONOMY =================
setInterval(() => {
  const r = Math.random();
  if (r < 0.1) GLOBAL_MULTIPLIER = 1.5;
  else if (r < 0.2) GLOBAL_MULTIPLIER = 0.7;
  else GLOBAL_MULTIPLIER = 1;
}, 60000);

// ================= PRECLAIM =================
async function loadPreclaimed() {
  for (const p of PRECLAIMED) {
    const exists = await Username.findOne({ name: p.name });
    if (!exists) {
      await Username.create({
        name: p.name,
        ownerId: p.ownerId,
        value: value(p.name),
        rarity: rarity(p.name)
      });
    }
  }
}

// ================= COMMANDS =================
const commands = [
  new SlashCommandBuilder().setName("claim").setDescription("Claim username").addStringOption(o => o.setName("name").setRequired(true)),
  new SlashCommandBuilder().setName("users").setDescription("Inventory"),
  new SlashCommandBuilder().setName("sell").setDescription("Sell").addStringOption(o => o.setName("name").setRequired(true)).addIntegerOption(o => o.setName("price").setRequired(true)),
  new SlashCommandBuilder().setName("market").setDescription("Market"),
  new SlashCommandBuilder().setName("buy").setDescription("Buy").addStringOption(o => o.setName("name").setRequired(true)),
  new SlashCommandBuilder().setName("trade").setDescription("Trade").addUserOption(o => o.setName("user").setRequired(true)),
  new SlashCommandBuilder().setName("auction").setDescription("Auction").addStringOption(o => o.setName("item").setRequired(true)).addIntegerOption(o => o.setName("time").setRequired(true)),
  new SlashCommandBuilder().setName("bid").setDescription("Bid").addIntegerOption(o => o.setName("amount").setRequired(true)),

  // ADMIN
  new SlashCommandBuilder().setName("admin").setDescription("Admin panel"),
  new SlashCommandBuilder().setName("logs").setDescription("Logs"),
  new SlashCommandBuilder().setName("freeze").setDescription("Freeze username").addStringOption(o => o.setName("name").setRequired(true)),
  new SlashCommandBuilder().setName("unfreeze").setDescription("Unfreeze username").addStringOption(o => o.setName("name").setRequired(true)),
  new SlashCommandBuilder().setName("revoke").setDescription("Delete username").addStringOption(o => o.setName("name").setRequired(true)),
  new SlashCommandBuilder().setName("addcurrency").setDescription("Add money").addUserOption(o => o.setName("user").setRequired(true)).addIntegerOption(o => o.setName("amount").setRequired(true)),
  new SlashCommandBuilder().setName("removecurrency").setDescription("Remove money").addUserOption(o => o.setName("user").setRequired(true)).addIntegerOption(o => o.setName("amount").setRequired(true)),
  new SlashCommandBuilder().setName("setbalance").setDescription("Set balance").addUserOption(o => o.setName("user").setRequired(true)).addIntegerOption(o => o.setName("amount").setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// ================= READY =================
client.once("ready", async () => {
  console.log("💎 V16 FULL MMO ONLINE");
  await loadPreclaimed();

  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
});

// ================= MAIN =================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  const user = await getUser(i.user.id);

  // ===== CLAIM =====
  if (i.commandName === "claim") {
    const name = i.options.getString("name");
    if (await Username.findOne({ name })) return i.reply("Taken");

    await Username.create({
      name,
      ownerId: i.user.id,
      value: value(name),
      rarity: rarity(name)
    });

    return i.reply(`✅ Claimed ${name}`);
  }

  // ===== USERS =====
  if (i.commandName === "users") {
    const items = await Username.find({ ownerId: i.user.id });
    return i.reply(items.map(x => `${x.name} | ${x.value}`).join("\n") || "Empty");
  }

  // ===== MARKET =====
  if (i.commandName === "market") {
    const items = await Username.find({ forSale: true });
    return i.reply(items.map(x => `${x.name} - ${x.price}`).join("\n") || "Empty");
  }

  // ===== BUY =====
  if (i.commandName === "buy") {
    const name = i.options.getString("name");
    const item = await Username.findOne({ name, forSale: true });
    if (!item) return i.reply("Not found");

    item.ownerId = i.user.id;
    item.forSale = false;
    await item.save();

    return i.reply(`Bought ${name}`);
  }

  // ===== SELL =====
  if (i.commandName === "sell") {
    const name = i.options.getString("name");
    const price = i.options.getInteger("price");

    const item = await Username.findOne({ name, ownerId: i.user.id });
    if (!item) return i.reply("Not yours");

    item.forSale = true;
    item.price = price;
    await item.save();

    return i.reply("Listed");
  }

  // ===== ADMIN CHECK =====
  if (i.commandName === "admin") {
    if (!isAdmin(i.member)) return i.reply("No access");
    return i.reply("Admin: freeze / revoke / currency / logs");
  }

  if (i.commandName === "logs") {
    if (!isAdmin(i.member)) return i.reply("No access");

    const logs = await Log.find().sort({ time: -1 }).limit(10);
    return i.reply(logs.map(l => l.type).join("\n"));
  }

  // ===== ADMIN ACTIONS =====
  if (!isAdmin(i.member)) return;

  if (i.commandName === "freeze") {
    const name = i.options.getString("name");
    const item = await Username.findOne({ name });
    if (!item) return i.reply("Not found");
    item.frozen = true;
    await item.save();
    return i.reply("Frozen");
  }

  if (i.commandName === "unfreeze") {
    const name = i.options.getString("name");
    const item = await Username.findOne({ name });
    if (!item) return i.reply("Not found");
    item.frozen = false;
    await item.save();
    return i.reply("Unfrozen");
  }

  if (i.commandName === "revoke") {
    const name = i.options.getString("name");
    await Username.deleteOne({ name });
    return i.reply("Deleted");
  }

  if (i.commandName === "addcurrency") {
    const u = i.options.getUser("user");
    const amount = i.options.getInteger("amount");
    const userDoc = await getUser(u.id);
    userDoc.balance += amount;
    await userDoc.save();
    return i.reply("Added");
  }

  if (i.commandName === "removecurrency") {
    const u = i.options.getUser("user");
    const amount = i.options.getInteger("amount");
    const userDoc = await getUser(u.id);
    userDoc.balance -= amount;
    await userDoc.save();
    return i.reply("Removed");
  }

  if (i.commandName === "setbalance") {
    const u = i.options.getUser("user");
    const amount = i.options.getInteger("amount");
    const userDoc = await getUser(u.id);
    userDoc.balance = amount;
    await userDoc.save();
    return i.reply("Set");
  }
});

client.login(process.env.TOKEN);
