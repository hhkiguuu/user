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

function isOwner(id) {
  return id === OWNER_ID;
}

// ================= COMMANDS =================
const commands = [

  new SlashCommandBuilder().setName("claim").setDescription("Claim username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("users").setDescription("Inventory"),

  new SlashCommandBuilder().setName("balance").setDescription("Balance"),

  new SlashCommandBuilder().setName("trade").setDescription("Escrow trade")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addStringOption(o => o.setName("offer").setRequired(true))
    .addStringOption(o => o.setName("request").setRequired(true)),

  new SlashCommandBuilder().setName("transfer").setDescription("Transfer username")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("userleaderboard").setDescription("Username leaderboard"),

  new SlashCommandBuilder().setName("moneyleaderboard").setDescription("Money leaderboard"),

].map(x => x.toJSON());

// ================= REGISTER =================
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

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
      value: 1000,
      rarity: "COMMON"
    });

    return i.reply(`Claimed ${name}`);
  }

  // ===== USERS (SAFE MENU FIX) =====
  if (i.commandName === "users") {
    const items = await Username.find({ ownerId: i.user.id });

    if (!items.length) return i.reply({ content: "Empty", ephemeral: true });

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("inv")
        .setPlaceholder("Select item")
        .addOptions(
          items.slice(0, 25).map(x => ({
            label: x.name,
            description: `${x.rarity} | ${x.value}`,
            value: x.name
          }))
        )
    );

    return i.reply({ content: "Inventory", components: [menu], ephemeral: true });
  }

  // ===== BALANCE =====
  if (i.commandName === "balance") {
    return i.reply(`💰 ${u.balance}`);
  }

  // ===== TRADE (REAL ESCROW START) =====
  if (i.commandName === "trade") {
    const target = i.options.getUser("user");
    const offer = i.options.getString("offer");
    const request = i.options.getString("request");

    const itemA = await Username.findOne({ name: offer, ownerId: i.user.id });
    const itemB = await Username.findOne({ name: request, ownerId: target.id });

    if (!itemA || !itemB) return i.reply("Invalid items");

    const trade = await Trade.create({
      from: i.user.id,
      to: target.id,
      offer,
      request
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

    return i.reply({
      content: `Trade sent to <@${target.id}>`,
      components: [row]
    });
  }

  // ===== TRANSFER =====
  if (i.commandName === "transfer") {
    const user = i.options.getUser("user");
    const name = i.options.getString("name");

    const item = await Username.findOne({ name, ownerId: i.user.id });
    if (!item) return i.reply("Not yours");

    item.ownerId = user.id;
    await item.save();

    return i.reply(`Transferred to <@${user.id}>`);
  }

  // ===== USER LEADERBOARD =====
  if (i.commandName === "userleaderboard") {
    const top = await Username.find().sort({ value: -1 }).limit(10);

    return i.reply(
      top.map((x, i) => `#${i + 1} ${x.name} - ${x.value}`).join("\n")
    );
  }

  // ===== MONEY LEADERBOARD =====
  if (i.commandName === "moneyleaderboard") {
    const top = await User.find().sort({ balance: -1 }).limit(10);

    return i.reply(
      top.map((x, i) => `#${i + 1} <@${x.discordId}> - ${x.balance}`).join("\n")
    );
  }
});

// ================= TRADE BUTTON SYSTEM (ESCROW COMPLETE SWAP) =================
client.on("interactionCreate", async (i) => {
  if (!i.isButton()) return;

  const [type, action, id] = i.customId.split("_");
  if (type !== "trade") return;

  const trade = await Trade.findById(id);
  if (!trade) return i.reply({ content: "Expired", ephemeral: true });

  if (i.user.id !== trade.from && i.user.id !== trade.to)
    return i.reply({ content: "Not your trade", ephemeral: true });

  if (action === "deny") {
    trade.status = "denied";
    await trade.save();

    return i.update({ content: "Trade denied", components: [] });
  }

  if (action === "accept") {
    trade.status = "completed";

    const itemA = await Username.findOne({ name: trade.offer, ownerId: trade.from });
    const itemB = await Username.findOne({ name: trade.request, ownerId: trade.to });

    if (!itemA || !itemB)
      return i.update({ content: "Trade failed (items missing)", components: [] });

    const temp = itemA.ownerId;
    itemA.ownerId = itemB.ownerId;
    itemB.ownerId = temp;

    await itemA.save();
    await itemB.save();
    await trade.save();

    return i.update({
      content: "Trade completed successfully",
      components: []
    });
  }
});

client.login(process.env.TOKEN);
