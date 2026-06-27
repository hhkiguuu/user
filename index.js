require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const mongoose = require("mongoose");
mongoose.connect(process.env.MONGO_URI);

// ================= CLIENT =================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ================= CONFIG =================
const OWNER_ID = process.env.OWNER_ID;

// ================= ECONOMY STATE =================
let MULTIPLIER = 1;
let ECONOMY_STATE = "stable"; // stable | inflation | crash

// ================= MODELS =================
const User = mongoose.model("User", new mongoose.Schema({
  discordId: String,
  balance: { type: Number, default: 1000 }
}));

const Item = mongoose.model("Item", new mongoose.Schema({
  name: { type: String, unique: true },
  ownerId: String,
  value: Number,
  rarity: String,
  forSale: Boolean,
  price: Number,
  locked: { type: Boolean, default: false }
}));

const Auction = mongoose.model("Auction", new mongoose.Schema({
  item: String,
  seller: String,
  highestBid: Number,
  highestBidder: String,
  endTime: Number,
  active: Boolean
}));

const Trade = mongoose.model("Trade", new mongoose.Schema({
  from: String,
  to: String,
  offer: String,
  request: String,
  locked: { type: Boolean, default: true },
  status: String
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

// AI PRICE ENGINE (simple simulation)
function price(name) {
  let base =
    name.length === 1 ? 10000000 :
    name.length === 2 ? 2000000 :
    name.length === 3 ? 500000 :
    name.length === 4 ? 120000 :
    5000;

  if (ECONOMY_STATE === "inflation") base *= 2;
  if (ECONOMY_STATE === "crash") base *= 0.5;

  if (/[0-9]/.test(name)) base *= 0.8;

  return Math.floor(base * MULTIPLIER);
}

// ================= COMMANDS =================
const commands = [

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim username")
    .addStringOption(o =>
      o.setName("name").setDescription("username").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check balance"),

  new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("View items"),

  new SlashCommandBuilder()
    .setName("market")
    .setDescription("Marketplace"),

  new SlashCommandBuilder()
    .setName("buy")
    .setDescription("Buy item")
    .addStringOption(o =>
      o.setName("name").setDescription("item").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("sell")
    .setDescription("Sell item")
    .addStringOption(o =>
      o.setName("name").setDescription("item").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("price").setDescription("price").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("auction")
    .setDescription("Place bid")
    .addStringOption(o =>
      o.setName("item").setDescription("item").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("amount").setDescription("bid").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Escrow trade")
    .addUserOption(o =>
      o.setName("user").setDescription("user").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("offer").setDescription("your item").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("request").setDescription("their item").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Admin panel")

].map(c => c.toJSON());

// ================= REGISTER =================
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );

  console.log("V2 ECONOMY ONLINE");
});

// ================= CLAIM =================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  const u = await getUser(i.user.id);

  if (i.commandName === "claim") {
    const name = i.options.getString("name");

    const exists = await Item.findOne({ name });
    if (exists)
      return i.reply(`❌ Taken by <@${exists.ownerId}>`);

    const item = await Item.create({
      name,
      ownerId: i.user.id,
      value: price(name),
      rarity: rarity(name)
    });

    return i.reply(`✅ Claimed **${item.name}** (${item.rarity})`);
  }

  // BALANCE
  if (i.commandName === "balance") {
    return i.reply(`💰 ${u.balance}`);
  }

  // ADMIN ONLY
  if (i.commandName === "admin") {
    if (i.user.id !== OWNER_ID) return i.reply("No permission");

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📊 ECONOMY STATUS")
          .addFields(
            { name: "State", value: ECONOMY_STATE },
            { name: "Multiplier", value: `${MULTIPLIER}` }
          )
      ]
    });
  }
});

// ================= ECONOMY EVENTS =================
// random inflation / crash system
setInterval(() => {
  const roll = Math.random();

  if (roll < 0.05) {
    ECONOMY_STATE = "crash";
    MULTIPLIER = 0.6;
  } else if (roll < 0.15) {
    ECONOMY_STATE = "inflation";
    MULTIPLIER = 2;
  } else {
    ECONOMY_STATE = "stable";
    MULTIPLIER = 1;
  }

  console.log("Economy updated:", ECONOMY_STATE);
}, 60000);

// ================= LOGIN =================
client.login(process.env.TOKEN);
