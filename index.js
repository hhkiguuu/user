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
  discordId: String,
  balance: { type: Number, default: 1000 }
}));

const Item = mongoose.model("Item", new mongoose.Schema({
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

function rarity(name) {
  if (name.length === 1) return "MYTHIC";
  if (name.length === 2) return "LEGENDARY";
  if (name.length === 3) return "EPIC";
  if (name.length === 4) return "RARE";
  return "COMMON";
}

// ================= COMMANDS =================
const commands = [

  new SlashCommandBuilder().setName("claim").setDescription("Claim username")
    .addStringOption(o => o.setName("name").setDescription("name").setRequired(true)),

  new SlashCommandBuilder().setName("balance").setDescription("Check balance"),

  new SlashCommandBuilder().setName("inventory").setDescription("View your items"),

  new SlashCommandBuilder().setName("market").setDescription("View market"),

  new SlashCommandBuilder().setName("sell").setDescription("Sell item")
    .addStringOption(o => o.setName("name").setRequired(true))
    .addIntegerOption(o => o.setName("price").setRequired(true)),

  new SlashCommandBuilder().setName("buy").setDescription("Buy item")
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("transfer").setDescription("Transfer item")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addStringOption(o => o.setName("name").setRequired(true)),

  new SlashCommandBuilder().setName("trade").setDescription("Escrow trade")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addStringOption(o => o.setName("offer").setRequired(true))
    .addStringOption(o => o.setName("request").setRequired(true)),

  new SlashCommandBuilder().setName("leaderboard").setDescription("Top users"),

  // ===== ADMIN =====
  new SlashCommandBuilder().setName("admin").setDescription("Admin panel"),

  new SlashCommandBuilder().setName("addmoney").setDescription("Add money")
    .addUserOption(o => o.setName("user").setDescription("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("amount").setRequired(true)),

  new SlashCommandBuilder().setName("removemoney").setDescription("Remove money")
    .addUserOption(o => o.setName("user").setDescription("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("amount").setRequired(true)),

  new SlashCommandBuilder().setName("setmoney").setDescription("Set money")
    .addUserOption(o => o.setName("user").setDescription("user").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("amount").setRequired(true)),

  new SlashCommandBuilder().setName("deleteitem").setDescription("Delete item")
    .addStringOption(o => o.setName("name").setRequired(true))

].map(c => c.toJSON());

// ================= REGISTER =================
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );

  console.log("V2 FULL SYSTEM ONLINE");
});

// ================= MAIN HANDLER =================
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  const user = await getUser(i.user.id);

  // ================= CLAIM =================
  if (i.commandName === "claim") {
    const name = i.options.getString("name");

    const exists = await Item.findOne({ name });
    if (exists)
      return i.reply(`❌ Taken by <@${exists.ownerId}>`);

    await Item.create({
      name,
      ownerId: i.user.id,
      value: 1000,
      rarity: rarity(name)
    });

    return i.reply(`✅ Claimed ${name}`);
  }

  // ================= BALANCE =================
  if (i.commandName === "balance") {
    return i.reply(`💰 ${user.balance}`);
  }

  // ================= INVENTORY (FIXED SAFE MENU) =================
  if (i.commandName === "inventory") {
    const items = await Item.find({ ownerId: i.user.id });

    if (!items.length)
      return i.reply({ content: "Empty inventory", ephemeral: true });

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

    return i.reply({ content: "📦 Inventory", components: [menu], ephemeral: true });
  }

  // ================= MARKET =================
  if (i.commandName === "market") {
    const items = await Item.find({ forSale: true });

    const embed = new EmbedBuilder()
      .setTitle("🏪 Market")
      .setDescription(
        items.length
          ? items.map(x =>
              `📦 ${x.name} | 💰 ${x.price} | 👤 <@${x.ownerId}>`
            ).join("\n")
          : "Empty market"
      );

    return i.reply({ embeds: [embed] });
  }

  // ================= SELL =================
  if (i.commandName === "sell") {
    const name = i.options.getString("name");
    const price = i.options.getInteger("price");

    const item = await Item.findOne({ name, ownerId: i.user.id });
    if (!item) return i.reply("Not yours");

    item.forSale = true;
    item.price = price;
    await item.save();

    return i.reply("Listed");
  }

  // ================= BUY (PING OWNER FIXED) =================
  if (i.commandName === "buy") {
    const name = i.options.getString("name");

    const item = await Item.findOne({ name, forSale: true });
    if (!item) return i.reply("Not found");

    const oldOwner = item.ownerId;

    item.ownerId = i.user.id;
    item.forSale = false;
    await item.save();

    await i.reply(`Bought ${name} from <@${oldOwner}>`);

    // 🔔 OWNER PING FIX
    i.channel.send(`🔔 <@${oldOwner}> your item **${name}** was purchased!`);
  }

  // ================= TRANSFER =================
  if (i.commandName === "transfer") {
    const userTarget = i.options.getUser("user");
    const name = i.options.getString("name");

    const item = await Item.findOne({ name, ownerId: i.user.id });
    if (!item) return i.reply("Not yours");

    item.ownerId = userTarget.id;
    await item.save();

    return i.reply(`Transferred to <@${userTarget.id}>`);
  }

  // ================= LEADERBOARD FIXED =================
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

  // ================= ADMIN PANEL =================
  if (i.commandName === "admin") {
    if (!isOwner(i.user.id))
      return i.reply("No permission");

    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("⚙️ Admin Panel")
          .setDescription("System online")
      ]
    });
  }

  // ================= ADMIN COMMANDS =================
  if (!isOwner(i.user.id)) return;

  if (i.commandName === "addmoney") {
    const u = i.options.getUser("user");
    const amt = i.options.getInteger("amount");

    const data = await getUser(u.id);
    data.balance += amt;
    await data.save();

    return i.reply("Added");
  }

  if (i.commandName === "removemoney") {
    const u = i.options.getUser("user");
    const amt = i.options.getInteger("amount");

    const data = await getUser(u.id);
    data.balance -= amt;
    await data.save();

    return i.reply("Removed");
  }

  if (i.commandName === "setmoney") {
    const u = i.options.getUser("user");
    const amt = i.options.getInteger("amount");

    const data = await getUser(u.id);
    data.balance = amt;
    await data.save();

    return i.reply("Set");
  }

  if (i.commandName === "deleteitem") {
    const name = i.options.getString("name");

    await Item.deleteOne({ name });

    return i.reply("Deleted");
  }
});

client.login(process.env.TOKEN);
