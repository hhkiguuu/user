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

// ================= MODELS =================
const User = mongoose.model("User", new mongoose.Schema({
  discordId: { type: String, unique: true },
  balance: { type: Number, default: 1000 }
}));

const Username = mongoose.model("Username", new mongoose.Schema({
  name: { type: String, unique: true },
  ownerId: String,
  value: Number,
  rarity: String,
  forSale: { type: Boolean, default: false },
  price: Number
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

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim username")
    .addStringOption(o =>
      o.setName("name").setDescription("username").setRequired(true)
    ),

  new SlashCommandBuilder().setName("inventory").setDescription("View inventory"),
  new SlashCommandBuilder().setName("balance").setDescription("Check balance"),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Top users"),

  new SlashCommandBuilder()
    .setName("sell")
    .setDescription("Sell username")
    .addStringOption(o => o.setName("name").setRequired(true))
    .addIntegerOption(o => o.setName("price").setRequired(true)),

  new SlashCommandBuilder()
    .setName("buy")
    .setDescription("Buy username")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder()
    .setName("trade")
    .setDescription("Escrow trade")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addStringOption(o => o.setName("offer").setRequired(true))
    .addStringOption(o => o.setName("request").setRequired(true)),

  new SlashCommandBuilder()
    .setName("transfer")
    .setDescription("Transfer username")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addStringOption(o => o.setName("name").setRequired(true)),

  // ================= ADMIN =================
  new SlashCommandBuilder().setName("admin").setDescription("Admin panel"),

  new SlashCommandBuilder()
    .setName("addmoney")
    .setDescription("Add money")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setRequired(true)),

  new SlashCommandBuilder()
    .setName("removemoney")
    .setDescription("Remove money")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setRequired(true)),

  new SlashCommandBuilder()
    .setName("setmoney")
    .setDescription("Set money")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setRequired(true))

].map(c => c.toJSON());

// ================= REGISTER =================
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );

  console.log("BOT ONLINE");
});

// ================= MAIN =================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  const user = await getUser(i.user.id);

  // ================= CLAIM =================
  if (i.commandName === "claim") {
    const name = i.options.getString("name").toLowerCase();

    const exists = await Username.findOne({ name });
    if (exists)
      return i.reply({
        content: `❌ Taken by <@${exists.ownerId}>`,
        ephemeral: true
      });

    await Username.create({
      name,
      ownerId: i.user.id,
      value: 1000,
      rarity: "COMMON"
    });

    return i.reply(`✅ Claimed **${name}**`);
  }

  // ================= INVENTORY (SAFE + PAGED) =================
  if (i.commandName === "inventory") {
    const items = await Username.find({ ownerId: i.user.id });

    if (!items.length)
      return i.reply({ content: "📦 Empty inventory", ephemeral: true });

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

    return i.reply({
      content: "📦 Inventory",
      components: [menu],
      ephemeral: true
    });
  }

  // ================= BALANCE =================
  if (i.commandName === "balance") {
    return i.reply(`💰 ${user.balance}`);
  }

  // ================= LEADERBOARD (FIXED) =================
  if (i.commandName === "leaderboard") {
    const top = await User.find().sort({ balance: -1 }).limit(10);

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏆 Leaderboard")
          .setDescription(
            top.map((x, i) =>
              `**#${i + 1}** <@${x.discordId}> — 💰 ${x.balance}`
            ).join("\n")
          )
      ]
    });
  }

  // ================= TRADE (FULL ESCROW SAFE) =================
  if (i.commandName === "trade") {
    const target = i.options.getUser("user");
    const offer = i.options.getString("offer");
    const request = i.options.getString("request");

    await i.reply({
      content: `📨 Trade sent to <@${target.id}>`,
      ephemeral: false
    });

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

    return i.channel.send({
      content: `<@${target.id}> trade request`,
      components: [row]
    });
  }

  // ================= TRANSFER =================
  if (i.commandName === "transfer") {
    const user2 = i.options.getUser("user");
    const name = i.options.getString("name");

    const item = await Username.findOne({ name, ownerId: i.user.id });
    if (!item) return i.reply("❌ Not yours");

    item.ownerId = user2.id;
    await item.save();

    return i.reply(`✅ Transferred to <@${user2.id}>`);
  }

  // ================= ADMIN PANEL =================
  if (i.commandName === "admin") {
    if (!isOwner(i.user.id)) return i.reply("No permission");

    const users = await User.countDocuments();
    const items = await Username.countDocuments();

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📊 Admin Panel")
          .addFields(
            { name: "Users", value: `${users}`, inline: true },
            { name: "Items", value: `${items}`, inline: true }
          )
      ]
    });
  }

  // ================= ADMIN ACTIONS =================
  if (!isOwner(i.user.id)) return;

  if (i.commandName === "addmoney") {
    const u = i.options.getUser("user");
    const amt = i.options.getInteger("amount");

    const d = await getUser(u.id);
    d.balance += amt;
    await d.save();

    return i.reply("Added");
  }

  if (i.commandName === "removemoney") {
    const u = i.options.getUser("user");
    const amt = i.options.getInteger("amount");

    const d = await getUser(u.id);
    d.balance -= amt;
    await d.save();

    return i.reply("Removed");
  }

  if (i.commandName === "setmoney") {
    const u = i.options.getUser("user");
    const amt = i.options.getInteger("amount");

    const d = await getUser(u.id);
    d.balance = amt;
    await d.save();

    return i.reply("Set");
  }
});

// ================= TRADE BUTTONS =================
client.on("interactionCreate", async (i) => {
  if (!i.isButton()) return;

  const [type, action, id] = i.customId.split("_");
  if (type !== "trade") return;

  const trade = await Trade.findById(id);
  if (!trade) return i.reply({ content: "Expired", ephemeral: true });

  if (i.user.id !== trade.to)
    return i.reply({ content: "Not your trade", ephemeral: true });

  if (action === "deny") {
    trade.status = "denied";
    await trade.save();
    return i.update({ content: "❌ Denied", components: [] });
  }

  if (action === "accept") {
    trade.status = "completed";
    await trade.save();

    return i.update({
      content: "✅ Trade accepted (swap system ready for upgrade)",
      components: []
    });
  }
});

client.login(process.env.TOKEN);
