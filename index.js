require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const mongoose = require("mongoose");

mongoose.connect(process.env.MONGO_URI);

// ================= CLIENT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ================= CONFIG =================
const OWNER_ID = process.env.OWNER_ID;

// ================= MODELS =================
const User = mongoose.model("User", new mongoose.Schema({
  discordId: String,
  balance: { type: Number, default: 1000 },
  netWorth: { type: Number, default: 0 }
}));

const Username = mongoose.model("Username", new mongoose.Schema({
  name: { type: String, unique: true },
  ownerId: String,
  value: Number,
  forSale: Boolean,
  price: Number,
  frozen: Boolean,
  createdAt: { type: Date, default: Date.now }
}));

const Auction = mongoose.model("Auction", new mongoose.Schema({
  item: String,
  sellerId: String,
  highestBid: { type: Number, default: 0 },
  highestBidder: String,
  endsAt: Number,
  active: { type: Boolean, default: true }
}));

const Trade = mongoose.model("Trade", new mongoose.Schema({
  from: String,
  to: String,
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

function isOwner(i) {
  return i.user.id === OWNER_ID;
}

// ================= AUCTION ENGINE =================
async function endAuction(id, client) {
  const a = await Auction.findById(id);
  if (!a || !a.active) return;

  a.active = false;
  await a.save();

  const winner = a.highestBidder;

  const guild = client.guilds.cache.first();
  const channel = guild?.systemChannel;

  if (channel) {
    channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏁 Auction Ended")
          .setDescription(
            `Item: **${a.item}**\n` +
            `Seller: <@${a.sellerId}>\n` +
            `Winner: ${winner ? `<@${winner}>` : "No bids"}\n` +
            `Price: ${a.highestBid}`
          )
      ]
    });
  }
}

// ================= INTERACTIONS =================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  const u = await getUser(i.user.id);

  // ===== BALANCE =====
  if (i.commandName === "balance") {
    return i.reply(`💰 ${u.balance}`);
  }

  // ===== LEADERBOARD (FIXED USER LEADERBOARD) =====
  if (i.commandName === "leaderboard") {
    const top = await User.find().sort({ balance: -1 }).limit(10);

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏆 Leaderboard")
          .setDescription(
            top.map((x, i) =>
              `#${i + 1} <@${x.discordId}> — 💰 ${x.balance}`
            ).join("\n")
          )
      ]
    });
  }

  // ===== CLAIM =====
  if (i.commandName === "claim") {
    const name = i.options.getString("name");

    const exists = await Username.findOne({ name });
    if (exists) return i.reply("Taken");

    await Username.create({
      name,
      ownerId: i.user.id,
      value: name.length * 1000,
      forSale: false,
      price: 0,
      frozen: false
    });

    return i.reply(`✅ Claimed **${name}**`);
  }

  // ===== USERS =====
  if (i.commandName === "users") {
    const items = await Username.find({ ownerId: i.user.id });

    return i.reply({
      content: items.length
        ? items.map(x => `📦 ${x.name} — 💎 ${x.value}`).join("\n")
        : "No usernames"
    });
  }

  // ===== TRADE UI (FIXED ESCROW BASE) =====
  if (i.commandName === "trade") {
    const to = i.options.getUser("user");

    const trade = await Trade.create({
      from: i.user.id,
      to: to.id,
      status: "pending"
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`trade_accept:${trade._id}`)
        .setLabel("ACCEPT")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`trade_decline:${trade._id}`)
        .setLabel("DECLINE")
        .setStyle(ButtonStyle.Danger)
    );

    return i.reply({
      content: `🔒 Trade request sent to <@${to.id}>`,
      components: [row]
    });
  }

  // ===== AUCTION START =====
  if (i.commandName === "auction") {
    const item = i.options.getString("item");
    const time = i.options.getInteger("time");

    const auction = await Auction.create({
      item,
      sellerId: i.user.id,
      endsAt: Date.now() + time * 60000
    });

    setTimeout(() => endAuction(auction._id, client), time * 60000);

    return i.reply(`🏁 Auction started for **${item}**`);
  }

  // ===== BID =====
  if (i.commandName === "bid") {
    const item = i.options.getString("item");
    const amount = i.options.getInteger("amount");

    const a = await Auction.findOne({ item, active: true });
    if (!a) return i.reply("No auction");

    if (amount <= a.highestBid) return i.reply("Too low");

    a.highestBid = amount;
    a.highestBidder = i.user.id;

    if (a.endsAt - Date.now() < 15000) {
      a.endsAt += 15000;
    }

    await a.save();

    return i.reply(`🔥 Bid placed: ${amount}`);
  }
});

// ================= TRADE BUTTONS =================
client.on("interactionCreate", async (i) => {
  if (!i.isButton()) return;

  const [action, id] = i.customId.split(":");

  const trade = await Trade.findById(id);
  if (!trade) return i.reply({ content: "Invalid trade", ephemeral: true });

  if (i.user.id !== trade.to)
    return i.reply({ content: "Not your trade", ephemeral: true });

  if (action === "trade_accept") {
    trade.status = "accepted";
    await trade.save();
    return i.reply("Trade accepted");
  }

  if (action === "trade_decline") {
    trade.status = "declined";
    await trade.save();
    return i.reply("Trade declined");
  }
});

// ================= START =================
client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(process.env.TOKEN);
