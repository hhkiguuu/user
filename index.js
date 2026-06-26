require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  StringSelectMenuBuilder,
  ComponentType
} = require("discord.js");

const mongoose = require("mongoose");
mongoose.connect(process.env.MONGO_URI);

// ================= CLIENT =================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ================= CONFIG =================
const OWNER_ID = process.env.OWNER_ID;

// ================= ECONOMY =================
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
  frozen: { type: Boolean, default: false }
}));

const Trade = mongoose.model("Trade", new mongoose.Schema({
  from: String,
  to: String,
  offer: String,
  request: String,
  status: { type: String, default: "pending" }
}));

// ================= HELPERS =================
async function getUser(id) {
  return await User.findOneAndUpdate(
    { discordId: id },
    { discordId: id },
    { upsert: true, new: true }
  );
}

function rarity(name) {
  if (name.length === 1) return "MYTHIC";
  if (name.length === 2) return "LEGENDARY";
  if (name.length === 3) return "EPIC";
  if (name.length === 4) return "RARE";
  return "COMMON";
}

function price(name) {
  let base =
    name.length === 1 ? 10000000 :
    name.length === 2 ? 2000000 :
    name.length === 3 ? 500000 :
    name.length === 4 ? 120000 :
    5000;

  if (/[0-9]/.test(name)) base *= 0.8;
  return Math.floor(base * MULTIPLIER);
}

// ================= COMMANDS =================
const commands = [

  new SlashCommandBuilder().setName("claim").setDescription("Claim username")
    .addStringOption(o => o.setName("name").setDescription("name").setRequired(true)),

  new SlashCommandBuilder().setName("users").setDescription("Inventory"),

  new SlashCommandBuilder().setName("balance").setDescription("Balance"),

  new SlashCommandBuilder().setName("market").setDescription("Market"),

  new SlashCommandBuilder().setName("sell").setDescription("Sell username")
    .addStringOption(o => o.setName("name").setRequired(true))
    .addIntegerOption(o => o.setName("price").setRequired(true)),

  new SlashCommandBuilder().setName("buy").setDescription("Buy username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("trade").setDescription("Escrow trade")
    .addUserOption(o => o.setName("user").setDescription("target").setRequired(true))
    .addStringOption(o => o.setName("offer").setDescription("offer").setRequired(true))
    .addStringOption(o => o.setName("request").setDescription("request").setRequired(true)),

  new SlashCommandBuilder().setName("transfer").setDescription("Transfer username")
    .addUserOption(o => o.setName("user").setDescription("target").setRequired(true))
    .addStringOption(o => o.setName("name").setDescription("name").setRequired(true)),

  // ===== ADMIN =====
  new SlashCommandBuilder().setName("addcurrency").setDescription("Add money")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setRequired(true)),

  new SlashCommandBuilder().setName("removecurrency").setDescription("Remove money")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setRequired(true)),

  new SlashCommandBuilder().setName("setbalance").setDescription("Set balance")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setRequired(true)),

  new SlashCommandBuilder().setName("revoke").setDescription("Delete username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("freeze").setDescription("Freeze username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("unfreeze").setDescription("Unfreeze username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("leaderboard").setDescription("Top users"),

  new SlashCommandBuilder().setName("admin").setDescription("Admin panel")

].map(x => x.toJSON());

// ================= REGISTER =================
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log("V18 ONLINE");
});

// ================= MAIN =================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  const u = await getUser(i.user.id);

  // ================= CLAIM =================
  if (i.commandName === "claim") {
    const name = i.options.getString("name");

    const exists = await Username.findOne({ name });
    if (exists) return i.reply("Taken");

    const item = await Username.create({
      name,
      ownerId: i.user.id,
      value: price(name),
      rarity: rarity(name)
    });

    return i.reply(`✅ Claimed ${name} (${item.rarity})`);
  }

  // ================= USERS (FIXED SELECT MENU) =================
  if (i.commandName === "users") {
    const items = await Username.find({ ownerId: i.user.id });

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("inventory")
        .setPlaceholder("Select item")
        .addOptions(
          items.map(x => ({
            label: x.name,
            description: `${x.rarity} | ${x.value}`,
            value: x.name
          }))
        )
    );

    return i.reply({ content: "📦 Inventory", components: [menu], ephemeral: true });
  }

  // ================= BALANCE =================
  if (i.commandName === "balance") {
    return i.reply(`💰 ${u.balance}`);
  }

  // ================= MARKET =================
  if (i.commandName === "market") {
    const items = await Username.find({ forSale: true });

    const embed = new EmbedBuilder()
      .setTitle("🏪 Market")
      .setDescription(
        items.map(x =>
          `📦 ${x.name} — 💰 ${x.price} — ✨ ${x.rarity} — 👤 <@${x.ownerId}>`
        ).join("\n") || "Empty"
      );

    return i.reply({ embeds: [embed] });
  }

  // ================= SELL =================
  if (i.commandName === "sell") {
    const name = i.options.getString("name");
    const priceVal = i.options.getInteger("price");

    const item = await Username.findOne({ name, ownerId: i.user.id });
    if (!item) return i.reply("Not yours");

    item.forSale = true;
    item.price = priceVal;
    await item.save();

    return i.reply("Listed");
  }

  // ================= BUY (PING OWNER FIX) =================
  if (i.commandName === "buy") {
    const name = i.options.getString("name");

    const item = await Username.findOne({ name, forSale: true });
    if (!item) return i.reply("Not found");

    const owner = item.ownerId;

    item.ownerId = i.user.id;
    item.forSale = false;
    await item.save();

    await i.reply(`Bought ${name} from <@${owner}>`);

    // 🔥 OWNER PING
    i.channel.send(`🔔 <@${owner}> your item **${name}** was bought!`);
  }

  // ================= TRANSFER =================
  if (i.commandName === "transfer") {
    const user = i.options.getUser("user");
    const name = i.options.getString("name");

    const item = await Username.findOne({ name, ownerId: i.user.id });
    if (!item) return i.reply("Not yours");

    item.ownerId = user.id;
    await item.save();

    return i.reply(`Transferred ${name} to <@${user.id}>`);
  }

  // ================= TRADE (FIXED ESCROW UI) =================
  if (i.commandName === "trade") {
    const target = i.options.getUser("user");

    const trade = await Trade.create({
      from: i.user.id,
      to: target.id,
      offer: i.options.getString("offer"),
      request: i.options.getString("request")
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`trade_accept_${trade._id}`)
        .setLabel("ACCEPT")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`trade_deny_${trade._id}`)
        .setLabel("DENY")
        .setStyle(ButtonStyle.Danger)
    );

    return i.reply({ content: `Trade sent to <@${target.id}>`, components: [row] });
  }

  // ================= LEADERBOARD FIX =================
  if (i.commandName === "leaderboard") {
    const top = await User.find().sort({ balance: -1 }).limit(10);

    return i.reply(
      top.map((x, idx) =>
        `#${idx + 1} <@${x.discordId}> — 💰 ${x.balance}`
      ).join("\n")
    );
  }

  // ================= ADMIN PANEL =================
  if (i.commandName === "admin") {
    if (i.user.id !== OWNER_ID) return i.reply("No permission");

    const users = await User.countDocuments();
    const items = await Username.countDocuments();

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📊 ADMIN DASHBOARD")
          .addFields(
            { name: "Users", value: `${users}`, inline: true },
            { name: "Items", value: `${items}`, inline: true }
          )
      ]
    });
  }

  // ================= ADMIN COMMANDS =================
  if (i.user.id !== OWNER_ID) return;

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

  if (i.commandName === "setbalance") {
    const user = i.options.getUser("user");
    const amt = i.options.getInteger("amount");

    const d = await getUser(user.id);
    d.balance = amt;
    await d.save();

    return i.reply("Set");
  }

  if (i.commandName === "revoke") {
    const name = i.options.getString("name");
    await Username.deleteOne({ name });

    return i.reply("Deleted");
  }

  if (i.commandName === "freeze") {
    const name = i.options.getString("name");
    const item = await Username.findOne({ name });

    item.frozen = true;
    await item.save();

    return i.reply("Frozen");
  }

  if (i.commandName === "unfreeze") {
    const name = i.options.getString("name");
    const item = await Username.findOne({ name });

    item.frozen = false;
    await item.save();

    return i.reply("Unfrozen");
  }
});

// ================= TRADE BUTTON HANDLER =================
client.on("interactionCreate", async (i) => {
  if (!i.isButton()) return;

  const [type, action, id] = i.customId.split("_");
  if (type !== "trade") return;

  const trade = await Trade.findById(id);
  if (!trade) return i.reply({ content: "Trade expired", ephemeral: true });

  if (i.user.id !== trade.to)
    return i.reply({ content: "Not your trade", ephemeral: true });

  if (action === "accept") {
    trade.status = "accepted";
    await trade.save();
    return i.update({ content: "Trade accepted", components: [] });
  }

  if (action === "deny") {
    trade.status = "denied";
    await trade.save();
    return i.update({ content: "Trade denied", components: [] });
  }
});

client.login(process.env.TOKEN);
