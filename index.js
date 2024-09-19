const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ]
});

const roleAssignments = {
  '💰': '1286277846754525194',
  '📦': '1286277915515949096',
  '🟢': '1286277613559742538',
  '🔵': '1286277434450120714',
  '🔥': '1286277883781709824',
  '⚡': '1286306479275511890' // Nouveau rôle pour les ventes flash
};

const channelMentions = {
  'EDP': '<@edp>',
  'Autre_vendeur': '<@autre vendeur>',
  '2euro': '<@deal2>',
  '1euro': '<@deal1>',
  'promo': '<@promo>',
  'vente_flash': '<@vente flah>'
};

// URLs de recherche sur Amazon
const AMAZON_URLS = [
  'https://www.amazon.fr/s?k=promo',
  'https://www.amazon.fr/s?k=electronique',
  'https://www.amazon.fr/s?k=jouets',
  'https://www.amazon.fr/s?k=ventes+flash', // Ventes flash
  'https://www.amazon.fr/s?k=beauté',
  'https://www.amazon.fr/s?k=sport',
  'https://www.amazon.fr/s?k=maison',
  'https://www.amazon.fr/s?k=mode',
  'https://www.amazon.fr/s?k=livres',
  'https://www.amazon.fr/s?k=informatique',
  'https://www.amazon.fr/s?k=outillage',
  'https://www.amazon.fr/s?k=accessoires+téléphone',
  'https://www.amazon.fr/s?k=bricolage',
  'https://www.amazon.fr/s?k=jardinage',
  'https://www.amazon.fr/s?k=alimentaire',
  'https://www.amazon.fr/s?k=audio+vidéo',
  'https://www.amazon.fr/s?k=photo',
  'https://www.amazon.fr/s?k=enfant',
  'https://www.amazon.fr/s?k=cuisine',
  'https://www.amazon.fr/s?k=montres'
];

const PRICE_THRESHOLD = 2;
const PRICE_THRESHOLD_1_EURO = 1;
const PROMO_THRESHOLD = 30;
const EDP_THRESHOLD = 90;
const CACHE_EXPIRY_TIME = 60 * 60 * 1000;

const CHECK_INTERVAL_EDP = 20000; // 20 secondes pour EDP
const CHECK_INTERVAL_VENTE_FLASH = 60000; // 60 secondes pour les ventes flash
const CHECK_INTERVAL_OTHER = 30000; // 30 secondes pour les autres catégories

const productCache = new Map();
const dealWatchList = new Map();
const logsChannelId = '1285977835365994506'; // Ajoutez l'ID de votre salon de logs ici

// Fonction pour ajouter un produit au cache
function addProductToCache(url) {
  productCache.set(url, Date.now());
  setTimeout(() => productCache.delete(url), CACHE_EXPIRY_TIME);
}

// Fonction pour vérifier si un produit est dans le cache
function isProductInCache(url) {
  return productCache.has(url);
}

// Gestion des rôles via réactions
client.on('messageCreate', async (message) => {
  if (message.content === '-role') {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Sélection de rôles')
      .setDescription(`Cliquez sur les emojis ci-dessous pour obtenir des notifications :
        💰 - Erreur de prix (EDP)
        📦 - Autres vendeurs
        🟢 - Produits à moins de 2€
        🔵 - Produits à moins de 1€
        🔥 - Promotions
        ⚡ - Ventes Flash`);

    const roleMessage = await message.channel.send({ embeds: [embed] });
    await roleMessage.react('💰');
    await roleMessage.react('📦');
    await roleMessage.react('🟢');
    await roleMessage.react('🔵');
    await roleMessage.react('🔥');
    await roleMessage.react('⚡'); // Emoji pour ventes flash
  }

  if (message.content.startsWith('-add_deal')) {
    const args = message.content.split(' ');
    const productUrl = args[1];
    const maxPrice = parseFloat(args[2]);

    if (!productUrl || isNaN(maxPrice)) {
      message.channel.send('Usage: `-add_deal <url> <prix_max>`');
      return;
    }

    dealWatchList.set(productUrl, maxPrice);
    message.channel.send(`Produit ajouté à la surveillance : ${productUrl} avec un prix maximum de ${maxPrice}€`);
    logMessage(`Produit ajouté à la surveillance manuelle: ${productUrl} avec un prix max de ${maxPrice}€`);
  }
});

// Ajout/Suppression des rôles en fonction des réactions
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  const roleId = roleAssignments[reaction.emoji.name];
  if (roleId) {
    const member = await reaction.message.guild.members.fetch(user.id);
    const role = reaction.message.guild.roles.cache.get(roleId);
    if (role) await member.roles.add(role);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  const roleId = roleAssignments[reaction.emoji.name];
  if (roleId) {
    const member = await reaction.message.guild.members.fetch(user.id);
    const role = reaction.message.guild.roles.cache.get(roleId);
    if (role) await member.roles.remove(role);
  }
});

// Fonction principale du bot pour surveiller les produits sur Amazon
client.once('ready', () => {
  logMessage(`Bot connecté en tant que ${client.user.tag}`);
  monitorAmazonProducts();
  monitorDeals(); // Lancer la surveillance des produits ajoutés manuellement
});

// Surveillance des produits Amazon, incluant la pagination et les ventes flash
async function monitorAmazonProducts() {
  for (const url of AMAZON_URLS) {
    if (!url || url.trim() === '') {
      logMessage('URL vide ou incorrecte ignorée');
      continue;
    }

    try {
      await monitorPage(url, 1); // Commence avec la première page de chaque URL
    } catch (error) {
      logMessage(`Erreur lors de la récupération des produits de l'URL ${url}: ${error.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, getCheckInterval(url))); // Ajustement intelligent des délais
  }
}

// Fonction pour ajuster l'intervalle de vérification selon l'URL
function getCheckInterval(url) {
  if (url.includes('ventes+flash')) {
    return CHECK_INTERVAL_VENTE_FLASH;
  } else if (url.includes('erreur+prix')) {
    return CHECK_INTERVAL_EDP;
  }
  return CHECK_INTERVAL_OTHER;
}

// Fonction pour parcourir plusieurs pages de résultats Amazon
async function monitorPage(url, page) {
  const paginatedUrl = `${url}&page=${page}`;
  const html = await fetchAmazonPage(paginatedUrl);
  if (!html) return;

  const $ = cheerio.load(html);

  $('.s-main-slot .s-result-item').each(async (i, element) => {
    const productTitle = $(element).find('h2 a span').text();
    const priceText = $(element).find('.a-price-whole').text();
    const price = parseFloat(priceText.replace(',', '.'));
    const oldPriceText = $(element).find('.a-text-price .a-offscreen').first().text();
    const oldPrice = parseFloat(oldPriceText.replace(',', '.'));
    const productUrl = 'https://www.amazon.fr' + $(element).find('h2 a').attr('href');
    const productImage = $(element).find('img').attr('src');

    let shippingCost = 0;
    const shippingText = $(element).find('.a-color-secondary .a-size-small').text();
    if (shippingText.toLowerCase().includes('livraison')) {
      const shippingCostText = shippingText.match(/(\d+,\d+)/);
      if (shippingCostText) shippingCost = parseFloat(shippingCostText[0].replace(',', '.'));
    }
    const totalPrice = price + shippingCost;

    if (!isProductInCache(productUrl) && totalPrice && oldPrice) {
      const discountPercentage = ((oldPrice - totalPrice) / oldPrice) * 100;

      if (discountPercentage >= PROMO_THRESHOLD) {
        sendProductToChannel(productTitle, totalPrice, oldPrice, discountPercentage, productUrl, productImage, 'promo');
      }
      if (totalPrice <= PRICE_THRESHOLD) {
        sendProductToChannel(productTitle, totalPrice, oldPrice, discountPercentage, productUrl, productImage, '2euro');
      }
      if (totalPrice <= PRICE_THRESHOLD_1_EURO) {
        sendProductToChannel(productTitle, totalPrice, oldPrice, discountPercentage, productUrl, productImage, '1euro');
      }
      if (discountPercentage >= EDP_THRESHOLD) {
        sendProductToChannel(productTitle, totalPrice, oldPrice, discountPercentage, productUrl, productImage, 'EDP');
      }

      // Détection des ventes flash
      const flashDealText = $(element).find('.dealBadge').text();
      if (flashDealText.toLowerCase().includes('vente flash')) {
        sendProductToChannel(productTitle, totalPrice, oldPrice, discountPercentage, productUrl, productImage, 'vente_flash');
      }

      addProductToCache(productUrl);
    }
  });

  // Vérifier s'il y a une page suivante
  const nextPage = $('.s-pagination-next');
  if (nextPage && !nextPage.hasClass('s-pagination-disabled')) {
    await monitorPage(url, page + 1); // Passe à la page suivante
  }
}

// Surveillance des produits ajoutés manuellement avec `-add_deal`
async function monitorDeals() {
  setInterval(async () => {
    for (const [url, maxPrice] of dealWatchList.entries()) {
      try {
        const html = await fetchAmazonPage(url);
        if (!html) continue;

        const $ = cheerio.load(html);
        const priceText = $('.a-price-whole').first().text();
        const price = parseFloat(priceText.replace(',', '.'));
        if (price <= maxPrice) {
          sendProductToChannel('Produit surveillé', price, maxPrice, 0, url, '', 'deal');
        }
      } catch (error) {
        logMessage(`Erreur lors de la surveillance des deals: ${error.message}`);
      }
    }
  }, CHECK_INTERVAL_OTHER);
}

// Fonction pour récupérer les pages Amazon avec gestion des erreurs
async function fetchAmazonPage(url, retries = 0) {
  if (!url || url.trim() === '') {
    logMessage(`Erreur: URL vide ou incorrecte: ${url}`);
    return null;
  }

  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    }
  };

  try {
    const { data } = await axios.get(url, options);
    return data;
  } catch (error) {
    logMessage(`Erreur lors de la récupération de l'URL ${url} avec le message d'erreur: ${error.message}`);
    if (retries < 5) {
      logMessage(`Nouvelle tentative pour accéder à ${url}, tentative ${retries + 1}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      return fetchAmazonPage(url, retries + 1);
    }
    logMessage(`Échec après plusieurs tentatives pour accéder à ${url}: ${error.message}`);
    return null;
  }
}

// Envoi du produit dans le salon approprié
function sendProductToChannel(title, price, oldPrice, discountPercentage, url, image, category) {
  const channelId = {
    'EDP': '1285953900066902057',
    'promo': '1285969661535453215',
    '2euro': '1285939619598172232',
    '1euro': '1255863140974071893',
    'Autre_vendeur': '1285974003307118644',
    'deal': '1285955371252580352',
    'vente_flash': '1286281265825321023' // Nouveau salon pour les ventes flash
  }[category];

  const channel = client.channels.cache.get(channelId);
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(title)
      .setURL(url)
      .setDescription(discountPercentage > 0 ? `Réduction de ${Math.round(discountPercentage)}%` : '')
      .setThumbnail(image)
      .addFields(
        { name: 'Prix actuel', value: `${price}€`, inline: true },
        { name: 'Prix habituel', value: `${oldPrice}€`, inline: true },
        { name: 'Lien', value: `[Acheter maintenant](${url})`, inline: true }
      )
      .setTimestamp();

    channel.send({ embeds: [embed] });
  }
}

// Fonction pour loguer des messages dans le salon "logs"
function logMessage(message) {
  const logsChannel = client.channels.cache.get(logsChannelId);
  if (logsChannel) {
    logsChannel.send(message);
  } else {
    console.log(`Logs: ${message}`);
  }
}

client.login(process.env.BOT_TOKEN);
