require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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
  claimedCount: { type: Number, default: 0 }
}));

const Username = mongoose.model("Username", new mongoose.Schema({
  name: { type: String, unique: true },
  ownerId: String,
  price: Number,
  forSale: { type: Boolean, default: false },
  frozen: { type: Boolean, default: false }
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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ================= IDS =================
const OWNER_ID = "1519064660501074133";
const ADMIN_ROLE = "1519756610287697920";

const FORCED = [
  { name: "why", ownerId: "1519400083970326608" },
  { name: "esex", ownerId: "1508616705520435211" }
];

// ================= ECONOMY =================
let inflation = 1.0;

// ================= HELPERS =================
async function getUser(id) {
  return await User.findOneAndUpdate(
    { discordId: id },
    { discordId: id },
    { upsert: true, new: true }
  );
}

function isAdmin(member) {
  if (!member) return false;
  if (member.id === OWNER_ID) return true;
  if (member.roles?.cache?.has(ADMIN_ROLE)) return true;
  return false;
}

function value(name) {
  let base =
    name.length === 1 ? 9000000 :
    name.length === 2 ? 2000000 :
    name.length === 3 ? 500000 :
    name.length === 4 ? 120000 :
    5000;

  return Math.floor(base * inflation);
}

function rarityScore(name) {
  let s = 0;
  if (name.length === 1) s += 1000;
  if (name.length === 2) s += 500;
  if (name.length === 3) s += 200;
  if (name.length === 4) s += 80;
  if (/^[a-z]+$/.test(name)) s += 50;
  if (/[0-9]/.test(name)) s -= 20;
  return s;
}

// ================= FORCE CLAIMS =================
async function forceClaims() {
  for (const f of FORCED) {
    const exists = await Username.findOne({ name: f.name });

    if (!exists) {
      await Username.create({
        name: f.name,
        ownerId: f.ownerId,
        price: value(f.name)
      });
    }
  }
}

// ================= COMMANDS =================
const commands = [
  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("market")
    .setDescription("Marketplace"),

  new SlashCommandBuilder()
    .setName("sell")
    .setDescription("Sell username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("buy")
    .setDescription("Buy username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("auction")
    .setDescription("Start auction")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View leaderboards")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// ================= READY =================
client.once("ready", async () => {
  console.log("💎 SWIPECORE FULL ONLINE");

  await forceClaims();

  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );

  // inflation system
  setInterval(() => {
    inflation += 0.01;
  }, 60000);
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async (i) => {

  const u = await getUser(i.user.id);

  // ================= CLAIM =================
  if (i.commandName === "claim") {

    const name = i.options.getString("name");

    const exists = await Username.findOne({ name });
    if (exists) return i.reply(`Owned by <@${exists.ownerId}>`);

    if (u.claimedCount >= 5 && !isAdmin(i.member))
      return i.reply("Claim limit reached");

    await Username.create({
      name,
      ownerId: i.user.id,
      price: value(name)
    });

    u.claimedCount++;
    await u.save();

    return i.reply(`✅ Claimed ${name}`);
  }

  // ================= MARKET =================
  if (i.commandName === "market") {

    const items = await Username.find({ forSale: true }).limit(10);

    const embed = new EmbedBuilder()
      .setTitle("🌍 MARKETPLACE")
      .setDescription(
        items.map(x =>
          `🏷 ${x.name} | 💰 ${x.price}\n👤 <@${x.ownerId}>`
        ).join("\n\n") || "Empty"
      );

    return i.reply({ embeds: [embed] });
  }

  // ================= SELL =================
  if (i.commandName === "sell") {

    const name = i.options.getString("name");

    const modal = new ModalBuilder()
      .setCustomId(`sell:${name}`)
      .setTitle("Sell Username");

    const price = new TextInputBuilder()
      .setCustomId("price")
      .setLabel("Price")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(price)
    );

    return i.showModal(modal);
  }

  // ================= BUY =================
  if (i.commandName === "buy") {

    const name = i.options.getString("name");

    const item = await Username.findOne({ name });
    if (!item || !item.forSale)
      return i.reply("Not for sale");

    const buyer = await getUser(i.user.id);
    const seller = await getUser(item.ownerId);

    if (buyer.swipebucks < item.price)
      return i.reply("Not enough money");

    buyer.swipebucks -= item.price;
    seller.swipebucks += item.price;

    item.ownerId = i.user.id;
    item.forSale = false;

    await buyer.save();
    await seller.save();
    await item.save();

    return i.reply(`Bought ${name}`);
  }

  // ================= AUCTION =================
  if (i.commandName === "auction") {

    const name = i.options.getString("name");

    await Auction.create({
      item: name,
      sellerId: i.user.id,
      highestBid: 0,
      highestBidder: null,
      endTime: Date.now() + 600000,
      active: true
    });

    return i.reply(`🏁 Auction started for ${name}`);
  }

  // ================= LEADERBOARD =================
  if (i.commandName === "leaderboard") {

    const users = await User.find({});

    const richest = users
      .sort((a, b) => b.swipebucks - a.swipebucks)
      .slice(0, 10);

    const usernames = await Username.find({});

    const rare = usernames
      .map(x => ({ name: x.name, score: rarityScore(x.name) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const embed = new EmbedBuilder()
      .setTitle("📊 LEADERBOARDS")
      .addFields(
        {
          name: "💰 Richest Users",
          value: richest.map((u, i) =>
            `#${i + 1} <@${u.discordId}> - ${u.swipebucks}`
          ).join("\n") || "None"
        },
        {
          name: "🏷 Rarest Usernames",
          value: rare.map((u, i) =>
            `#${i + 1} ${u.name} - ${u.score}`
          ).join("\n") || "None"
        }
      );

    return i.reply({ embeds: [embed] });
  }

  // ================= SELL MODAL =================
  if (i.isModalSubmit() && i.customId.startsWith("sell:")) {

    const name = i.customId.split(":")[1];
    const price = Number(i.fields.getTextInputValue("price"));

    const item = await Username.findOne({ name });

    if (!item || item.ownerId !== i.user.id)
      return i.reply({ content: "Not yours", ephemeral: true });

    item.price = price;
    item.forSale = true;

    await item.save();

    return i.reply({ content: `Listed ${name}`, ephemeral: true });
  }
});

// ================= BID SYSTEM =================
client.on("messageCreate", async (m) => {

  if (!m.content.startsWith("!bid ")) return;

  const [, amount, name] = m.content.split(" ");
  const auction = await Auction.findOne({ item: name, active: true });

  if (!auction) return;

  const user = await getUser(m.author.id);
  const bid = Number(amount);

  if (bid <= auction.highestBid) return;

  if (user.swipebucks < bid) return;

  auction.highestBid = bid;
  auction.highestBidder = m.author.id;

  await auction.save();

  m.reply(`🔥 ${m.author.username} bid ${bid}`);
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
