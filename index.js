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

// ================= ECONOMY =================
let MULTIPLIER = 1;

// inflation system
setInterval(() => {
  const change = Math.random() < 0.5 ? -0.02 : 0.03;
  MULTIPLIER = Math.max(0.5, Math.min(2, MULTIPLIER + change));
}, 600000);

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

  if (/^[a-z]+$/.test(name)) v += 100000;
  if (/[0-9]/.test(name)) v -= 20000;

  return Math.floor(v * MULTIPLIER);
}

async function log(action, by, target = "none") {
  await Audit.create({ action, by, target });
}

// ================= COMMANDS =================
const commands = [
  new SlashCommandBuilder().setName("claim").setDescription("Claim username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("users").setDescription("Inventory"),

  new SlashCommandBuilder().setName("balance").setDescription("Balance"),

  new SlashCommandBuilder().setName("market").setDescription("Market"),

  new SlashCommandBuilder().setName("sell").setDescription("Sell")
    .addStringOption(o => o.setName("name").setRequired(true))
    .addIntegerOption(o => o.setName("price").setRequired(true)),

  new SlashCommandBuilder().setName("buy").setDescription("Buy")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("trade").setDescription("Trade")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addStringOption(o => o.setName("offer").setRequired(true))
    .addStringOption(o => o.setName("request").setRequired(true)),

  new SlashCommandBuilder().setName("auction").setDescription("Auction")
    .addStringOption(o => o.setName("item").setRequired(true))
    .addIntegerOption(o => o.setName("time").setRequired(true)),

  new SlashCommandBuilder().setName("bid").setDescription("Bid auction")
    .addStringOption(o => o.setName("item").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setRequired(true)),

  new SlashCommandBuilder().setName("leaderboard").setDescription("Leaderboard"),

  new SlashCommandBuilder().setName("addcurrency").setDescription("Add money")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setRequired(true)),

  new SlashCommandBuilder().setName("removecurrency").setDescription("Remove money")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setRequired(true)),

  new SlashCommandBuilder().setName("freeze").setDescription("Freeze username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("unfreeze").setDescription("Unfreeze username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("revoke").setDescription("Delete username")
    .addStringOption(o => o.setName("name").setRequired(true))
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

  // ================= BUTTON TRADE HANDLER =================
  if (i.isButton()) {
    const [type, id] = i.customId.split(":");

    const trade = await Trade.findById(id);
    if (!trade || trade.status !== "pending") {
      return i.reply({ content: "❌ Invalid trade", ephemeral: true });
    }

    if (i.user.id !== trade.to) {
      return i.reply({ content: "❌ Not your trade", ephemeral: true });
    }

    const offerItem = await Username.findOne({
      name: trade.offer,
      ownerId: trade.from
    });

    const requestItem = await Username.findOne({
      name: trade.request,
      ownerId: trade.to
    });

    // ================= ACCEPT =================
    if (type === "t_acc") {

      if (!offerItem || !requestItem) {
        trade.status = "failed";
        await trade.save();
        return i.update({ content: "❌ Missing items", components: [] });
      }

      // 🔥 REAL ESCROW TRANSFER
      offerItem.ownerId = trade.to;
      requestItem.ownerId = trade.from;

      await offerItem.save();
      await requestItem.save();

      trade.status = "accepted";
      await trade.save();

      return i.update({
        content: "✅ Trade completed (real escrow swap)",
        components: []
      });
    }

    // ================= DECLINE =================
    if (type === "t_dec") {
      trade.status = "declined";
      await trade.save();

      return i.update({
        content: "❌ Trade declined",
        components: []
      });
    }
  }

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

  // ===== AUCTION =====
  if (i.commandName === "auction") {
    await Auction.create({
      item: i.options.getString("item"),
      sellerId: i.user.id,
      highestBid: 0,
      endsAt: Date.now() + i.options.getInteger("time") * 60000,
      active: true
    });

    return i.reply("🏁 Auction started");
  }

  // ===== BID =====
  if (i.commandName === "bid") {
    const a = await Auction.findOne({
      item: i.options.getString("item"),
      active: true
    });

    if (!a) return i.reply("No auction");

    const amount = i.options.getInteger("amount");
    if (amount <= a.highestBid) return i.reply("Too low");

    if (a.endsAt - Date.now() < 15000) a.endsAt += 15000;

    a.highestBid = amount;
    a.highestBidder = i.user.id;

    await a.save();
    return i.reply("🔥 Bid placed");
  }

  // ===== LEADERBOARD (USERNAME VALUE) =====
  if (i.commandName === "leaderboard") {
    const top = await Username.find().sort({ value: -1 }).limit(10);

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏆 Username Leaderboard")
          .setDescription(
            top.map((x, i) =>
              `#${i + 1} **${x.name}** — 💎 ${x.value}`
            ).join("\n")
          )
      ]
    });
  }

  // ===== ADMIN =====
  if (!isAdmin(i.member)) return;

  if (i.commandName === "addcurrency") {
    const user = i.options.getUser("user");
    const amt = i.options.getInteger("amount");

    const d = await getUser(user.id);
    d.balance += amt;
    await d.save();

    await log("ADMIN_ADD", i.user.id, user.id);
    return i.reply("Added");
  }

  if (i.commandName === "removecurrency") {
    const user = i.options.getUser("user");
    const amt = i.options.getInteger("amount");

    const d = await getUser(user.id);
    d.balance -= amt;
    await d.save();

    await log("ADMIN_REMOVE", i.user.id, user.id);
    return i.reply("Removed");
  }

  if (i.commandName === "freeze") {
    const x = await Username.findOne({ name: i.options.getString("name") });
    x.frozen = true;
    await x.save();

    await log("FREEZE", i.user.id, x.name);
    return i.reply("Frozen");
  }

  if (i.commandName === "unfreeze") {
    const x = await Username.findOne({ name: i.options.getString("name") });
    x.frozen = false;
    await x.save();

    await log("UNFREEZE", i.user.id, x.name);
    return i.reply("Unfrozen");
  }

  if (i.commandName === "revoke") {
    const name = i.options.getString("name");
    await Username.deleteOne({ name });

    await log("REVOKE", i.user.id, name);
    return i.reply("Deleted");
  }
});

client.login(process.env.TOKEN);
