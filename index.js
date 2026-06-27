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
  StringSelectMenuBuilder
} = require("discord.js");

const mongoose = require("mongoose");
mongoose.connect(process.env.MONGO_URI);

// ================= CLIENT =================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ================= CONFIG =================
const OWNER_ID = process.env.OWNER_ID;

// ================= ECONOMY SYSTEM =================
let INFLATION = 1;

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

// 🧠 AI PRICING ENGINE
function aiPrice(name) {
  let base =
    name.length === 1 ? 10000000 :
    name.length === 2 ? 2000000 :
    name.length === 3 ? 500000 :
    name.length === 4 ? 120000 :
    5000;

  if (/[0-9]/.test(name)) base *= 0.7;
  if (/^[a-z]+$/.test(name)) base *= 1.2;

  return Math.floor(base * INFLATION);
}

// ================= COMMANDS =================
const commands = [

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim username")
    .addStringOption(o =>
      o.setName("name")
        .setDescription("Username to claim")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("users")
    .setDescription("Inventory"),

  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Balance"),

  new SlashCommandBuilder()
    .setName("market")
    .setDescription("Market"),

  new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Escrow trade")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Trade target user")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("offer")
        .setDescription("Your item")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("request")
        .setDescription("Their item")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("transfer")
    .setDescription("Transfer username")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Target user")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("name")
        .setDescription("Username")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("bid")
    .setDescription("Bid auction")
    .addStringOption(o =>
      o.setName("item")
        .setDescription("Auction item")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Bid amount")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Top users"),

  // ===== ADMIN =====
  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Admin panel"),

  new SlashCommandBuilder()
    .setName("addmoney")
    .setDescription("Add money")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Amount")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("removemoney")
    .setDescription("Remove money")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Amount")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setmoney")
    .setDescription("Set balance")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Amount")
        .setRequired(true)
    )
  new SlashCommandBuilder()
  .setName("buy")
  .setDescription("Buy a username from the market")
  .addStringOption(o =>
    o.setName("name")
      .setDescription("Username to buy")
      .setRequired(true)
  ),
].map(c => c.toJSON());

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

  // ❌ already taken → PING OWNER
  if (exists) {
    return i.reply({
      content: `❌ That username is already owned by <@${exists.ownerId}>`
    });
  }

  // ✅ create claim
  await Username.create({
    name,
    ownerId: i.user.id,
    value: 1000,
    rarity: "COMMON"
  });

  return i.reply(`✅ You claimed **${name}**`);
}

  // ===== INVENTORY (FIXED PAGINATION SAFE) =====
  if (i.commandName === "users") {
    const items = await Username.find({ ownerId: i.user.id });

    if (!items.length) return i.reply("Empty");

    const page = items.slice(0, 25);

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("inv")
        .setPlaceholder("Select item")
        .addOptions(
          page.map(x => ({
            label: x.name,
            description: `${x.rarity} | ${x.value}`,
            value: x.name
          }))
        )
    );

    return i.reply({
      content: "📦 Inventory (page 1)",
      components: [menu],
      ephemeral: true
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
      .setTitle("🏪 MARKET")
      .setDescription(
        items.slice(0, 10).map(x =>
          `📦 ${x.name} — 💰 ${x.price} — 👤 <@${x.ownerId}>`
        ).join("\n") || "Empty"
      );

    return i.reply({ embeds: [embed] });
  }

  // ===== TRADE (FULL ESCROW SAFE SWAP) =====
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

    return i.reply({
      content: `🔒 Trade sent to <@${target.id}>`,
      components: [row]
    });
  }

  // ===== TRANSFER (PING OWNER FIXED) =====
  if (i.commandName === "transfer") {
  const user = i.options.getUser("user");
  const name = i.options.getString("name");

  const item = await Username.findOne({ name, ownerId: i.user.id });
  if (!item) return i.reply("Not yours");

  const oldOwner = item.ownerId;

  item.ownerId = user.id;
  await item.save();

  await i.reply(`✅ Transferred **${name}** to <@${user.id}>`);

  // 🔔 PINGS
  i.channel.send(`📦 <@${oldOwner}> gave **${name}** to <@${user.id}>`);
}

  // ===== LEADERBOARD =====
  if (i.commandName === "leaderboard") {
    const top = await User.find().sort({ balance: -1 }).limit(10);

    return i.reply(
      top.map((x, idx) =>
        `#${idx + 1} <@${x.discordId}> — 💰 ${x.balance}`
      ).join("\n")
    );
  }

  // ===== ADMIN PANEL =====
  if (i.commandName === "admin") {
    if (!isOwner(i.user.id)) return i.reply("No permission");

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

  const commands = [

  new SlashCommandBuilder().setName("claim")...
  new SlashCommandBuilder().setName("users")...
  new SlashCommandBuilder().setName("balance")...

  // 👇 ADD IT HERE
  new SlashCommandBuilder()
    .setName("buy")
    .setDescription("Buy a username from the market")
    .addStringOption(o =>
      o.setName("name")
        .setDescription("Username to buy")
        .setRequired(true)
    ),

  new SlashCommandBuilder().setName("trade")...
];
  // ===== ADMIN MONEY COMMANDS =====
  if (!isOwner(i.user.id)) return;

  if (i.commandName === "addmoney") {
    const user = i.options.getUser("user");
    const amount = i.options.getInteger("amount");

    const d = await getUser(user.id);
    d.balance += amount;
    await d.save();

    return i.reply("Added");
  }

  if (i.commandName === "removemoney") {
    const user = i.options.getUser("user");
    const amount = i.options.getInteger("amount");

    const d = await getUser(user.id);
    d.balance -= amount;
    await d.save();

    return i.reply("Removed");
  }

  if (i.commandName === "setmoney") {
    const user = i.options.getUser("user");
    const amount = i.options.getInteger("amount");

    const d = await getUser(user.id);
    d.balance = amount;
    await d.save();

    return i.reply("Set");
  }
});

// ===== TRADE BUTTON HANDLER (SAFE SWAP FINAL) =====
client.on("interactionCreate", async (i) => {
  if (!i.isButton()) return;

  const [type, action, id] = i.customId.split("_");
  if (type !== "trade") return;

  const trade = await Trade.findById(id);
  if (!trade) return i.reply({ content: "Expired", ephemeral: true });

  if (i.user.id !== trade.from && i.user.id !== trade.to)
    return i.reply({ content: "Not your trade", ephemeral: true });

  if (action === "deny") {
    await trade.deleteOne();
    return i.update({ content: "Trade denied", components: [] });
  }

  if (action === "accept") {
    const itemA = await Username.findOne({ name: trade.offer, ownerId: trade.from });
    const itemB = await Username.findOne({ name: trade.request, ownerId: trade.to });

    if (!itemA || !itemB)
      return i.update({ content: "Trade failed", components: [] });

    const temp = itemA.ownerId;
    itemA.ownerId = itemB.ownerId;
    itemB.ownerId = temp;

    await itemA.save();
    await itemB.save();
    await trade.deleteOne();

    return i.update({ content: "Trade completed", components: [] });
  }
});

client.login(process.env.TOKEN);
