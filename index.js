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
  swipebucks: { type: Number, default: 1000 }
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
  status: { type: String, default: "pending" },
  locked: { type: Boolean, default: false }
}));

const Auction = mongoose.model("Auction", new mongoose.Schema({
  name: String,
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
  return member?.id === OWNER_ID || member?.roles?.cache?.has(ADMIN_ROLE);
}

function value(name) {
  return name.length <= 2 ? 2500000 :
         name.length === 3 ? 600000 :
         name.length === 4 ? 120000 : 5000;
}

// ================= PRECLAIMED USERS =================
const PRECLAIMED = [
  { name: "why", ownerId: "1519400083970326608" },
  { name: "esex", ownerId: "1508616705520435211" }
];

async function seedUsers() {
  for (const u of PRECLAIMED) {
    const exists = await Username.findOne({ name: u.name });
    if (!exists) {
      await Username.create({
        name: u.name,
        ownerId: u.ownerId,
        price: value(u.name)
      });
    }
  }
}

// ================= COMMANDS =================
const commands = [

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim username")
    .addStringOption(o =>
      o.setName("name")
        .setDescription("Username")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("market")
    .setDescription("Marketplace"),

  new SlashCommandBuilder()
    .setName("sell")
    .setDescription("Sell username")
    .addStringOption(o =>
      o.setName("name")
        .setDescription("Username")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("bid")
    .setDescription("Bid on auction")
    .addStringOption(o =>
      o.setName("name")
        .setDescription("Auction name")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Bid amount")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Economy rankings"),

  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Admin panel")

].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// ================= READY =================
client.once("ready", async () => {
  console.log("💎 SWIPECORE V3 ONLINE");

  await seedUsers();

  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
});

// ================= MARKET PAGINATION =================
async function marketPage(page = 0) {
  const items = await Username.find({ forSale: true })
    .skip(page * 5)
    .limit(5);

  return new EmbedBuilder()
    .setTitle("🌍 Marketplace")
    .setDescription(
      items.map(x =>
        `🏷 ${x.name} | 💰 ${x.price}\n👤 <@${x.ownerId}>`
      ).join("\n\n") || "Empty"
    );
}

// ================= INTERACTIONS =================
client.on("interactionCreate", async (i) => {

  const u = await getUser(i.user.id);

  // ================= CLAIM =================
  if (i.commandName === "claim") {

    const name = i.options.getString("name");

    const exists = await Username.findOne({ name });
    if (exists) return i.reply(`Owned by <@${exists.ownerId}>`);

    await Username.create({
      name,
      ownerId: i.user.id,
      price: value(name)
    });

    return i.reply(`Claimed ${name}`);
  }

  // ================= MARKET =================
  if (i.commandName === "market") {

    const embed = await marketPage(0);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("market_prev:0")
        .setLabel("⬅")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("market_next:0")
        .setLabel("➡")
        .setStyle(ButtonStyle.Primary)
    );

    return i.reply({ embeds: [embed], components: [row] });
  }

  // ================= SELL =================
  if (i.commandName === "sell") {

    const name = i.options.getString("name");

    const item = await Username.findOne({ name });

    if (!item || item.ownerId !== i.user.id)
      return i.reply("Not yours");

    if (item.frozen)
      return i.reply("Frozen");

    item.forSale = true;
    item.price = value(name);

    await item.save();

    return i.reply(`Listed ${name}`);
  }

  // ================= BID SYSTEM =================
  if (i.commandName === "bid") {

    const name = i.options.getString("name");
    const amount = i.options.getInteger("amount");

    const auction = await Auction.findOne({ name, active: true });

    if (!auction) return i.reply("No auction");

    if (amount <= auction.highestBid)
      return i.reply("Bid too low");

    const user = await getUser(i.user.id);

    if (user.swipebucks < amount)
      return i.reply("Not enough money");

    auction.highestBid = amount;
    auction.highestBidder = i.user.id;

    await auction.save();

    return i.reply(`🔥 Bid placed: ${amount}`);
  }

  // ================= LEADERBOARD =================
  if (i.commandName === "leaderboard") {

    const users = await User.find({});
    const names = await Username.find({});

    const rich = users.sort((a, b) => b.swipebucks - a.swipebucks).slice(0, 10);
    const rare = names.sort((a, b) => a.name.length - b.name.length).slice(0, 10);

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📊 Leaderboard")
          .addFields(
            {
              name: "💰 Richest",
              value: rich.map((u, i) =>
                `#${i + 1} <@${u.discordId}> - ${u.swipebucks}`
              ).join("\n") || "None"
            },
            {
              name: "🏷 Rarest",
              value: rare.map((x, i) =>
                `#${i + 1} ${x.name}`
              ).join("\n") || "None"
            }
          )
      ]
    });
  }

  // ================= ADMIN =================
  if (i.commandName === "admin") {

    if (!isAdmin(i.member))
      return i.reply({ content: "No permission", ephemeral: true });

    const frozen = await Username.find({ frozen: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("freeze_all")
        .setLabel("Freeze All")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("unfreeze_all")
        .setLabel("Unfreeze All")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("stats")
        .setLabel("Stats")
        .setStyle(ButtonStyle.Primary)
    );

    return i.reply({
      content: `❄ Frozen: ${frozen.length}`,
      components: [row],
      ephemeral: true
    });
  }

  // ================= BUTTONS =================
  if (!i.isButton()) return;

  if (i.customId === "freeze_all") {
    if (!isAdmin(i.member)) return;
    await Username.updateMany({}, { frozen: true });
    return i.reply({ content: "Frozen all", ephemeral: true });
  }

  if (i.customId === "unfreeze_all") {
    if (!isAdmin(i.member)) return;
    await Username.updateMany({}, { frozen: false });
    return i.reply({ content: "Unfrozen all", ephemeral: true });
  }

  if (i.customId === "stats") {
    const users = await User.countDocuments();
    const names = await Username.countDocuments();

    return i.reply({
      content: `Users: ${users}\nNames: ${names}`,
      ephemeral: true
    });
  }

  // MARKET PAGE NAV
  if (i.customId.startsWith("market_next")) {
    const page = Number(i.customId.split(":")[1]) + 1;
    const embed = await marketPage(page);

    return i.update({
      embeds: [embed],
      components: i.message.components
    });
  }

  if (i.customId.startsWith("market_prev")) {
    const page = Math.max(0, Number(i.customId.split(":")[1]) - 1);
    const embed = await marketPage(page);

    return i.update({
      embeds: [embed],
      components: i.message.components
    });
  }
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
