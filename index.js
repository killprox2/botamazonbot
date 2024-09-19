const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ]
});

// Exemple de proxy HTTP gratuit
const proxy = {
  host: '36.72.252.71',  // Remplacez par l'IP du proxy
  port: '8080' // Remplacez par le port du proxy
};

// Utilisation d'un proxy avec axios
const options = {
  proxy: {
    host: proxy.host,
    port: proxy.port
  },
  headers: {
    'User-Agent': 'Mozilla/5.0',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  }
};

axios.get('https://www.amazon.fr', options)
  .then(response => {
    console.log('Réponse reçue avec proxy', response.data);
  })
  .catch(error => {
    console.log('Erreur lors de l\'utilisation du proxy :', error);
  });

// Rôles réservés
const ADMIN_ROLE_ID = 'ID_DU_ROLE_ADMIN'; // Remplacez par l'ID du rôle administrateur
const PREMIUM_ROLE_ID = 'ID_DU_ROLE_PREMIUM'; // Remplacez par l'ID du rôle premium

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
  'vente_flash': '<@vente flash>'
};

// Configuration dynamique des paramètres du bot
let MAX_PAGES = 5;
let CHECK_INTERVAL_EDP = 20000;
let CHECK_INTERVAL_VENTE_FLASH = 60000;
let CHECK_INTERVAL_OTHER = 30000;

const productCache = new Map();
const dealWatchList = new Map();
const userNotifications = new Map(); // Map pour les préférences utilisateur
const logsChannelId = '1285977835365994506'; // Ajoutez l'ID de votre salon de logs ici

let monitoringInterval;
let dealInterval;

// Charger le cache à partir d'un fichier
function loadCache() {
  if (fs.existsSync('cache.json')) {
    const data = fs.readFileSync('cache.json');
    const parsed = JSON.parse(data);
    parsed.forEach(([key, value]) => productCache.set(key, value));
  }
}

// Sauvegarder le cache dans un fichier
function saveCache() {
  const data = JSON.stringify([...productCache]);
  fs.writeFileSync('cache.json', data);
}

// Vérifier si un utilisateur a le rôle admin
function isAdmin(member) {
  return member.roles.cache.has(ADMIN_ROLE_ID);
}

// Vérifier si un utilisateur est Premium
function isPremium(member) {
  return member.roles.cache.has(PREMIUM_ROLE_ID);
}

// Gestion des rôles via réactions
client.on('messageCreate', async (message) => {
  const member = message.member;

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

  // Commandes réservées aux administrateurs
  if (message.content.startsWith('-set_interval')) {
    if (!isAdmin(member)) {
      message.reply('Seuls les administrateurs peuvent utiliser cette commande.');
      return;
    }

    const args = message.content.split(' ');
    const intervalType = args[1];
    const newInterval = parseInt(args[2]);

    if (isNaN(newInterval)) {
      message.reply('Veuillez spécifier un intervalle valide en millisecondes.');
      return;
    }

    switch (intervalType) {
      case 'edp':
        CHECK_INTERVAL_EDP = newInterval;
        message.reply(`Intervalle des erreurs de prix modifié à ${newInterval} ms.`);
        break;
      case 'vente_flash':
        CHECK_INTERVAL_VENTE_FLASH = newInterval;
        message.reply(`Intervalle des ventes flash modifié à ${newInterval} ms.`);
        break;
      case 'other':
        CHECK_INTERVAL_OTHER = newInterval;
        message.reply(`Intervalle des autres produits modifié à ${newInterval} ms.`);
        break;
      default:
        message.reply('Type d\'intervalle non valide. Utilisez : edp, vente_flash ou other.');
    }
  }

  // Commandes réservées aux membres Premium
  if (message.content.startsWith('-search_amazon')) {
    if (!isPremium(member)) {
      message.reply('Cette commande est réservée aux membres Premium.');
      return;
    }

    const args = message.content.split(' ');
    const searchQuery = args.slice(1).join(' ');
    if (!searchQuery) {
      message.reply('Veuillez spécifier un terme de recherche.');
      return;
    }

    const searchUrl = `https://www.amazon.fr/s?k=${encodeURIComponent(searchQuery)}`;
    const html = await fetchAmazonPage(searchUrl);

    if (html) {
      const $ = cheerio.load(html);
      const productTitle = $('.s-main-slot .s-result-item h2 a span').first().text();
      const productUrl = 'https://www.amazon.fr' + $('.s-main-slot .s-result-item h2 a').first().attr('href');
      const price = $('.s-main-slot .s-result-item .a-price-whole').first().text();

      if (productTitle) {
        const embed = new EmbedBuilder()
          .setTitle(productTitle)
          .setURL(productUrl)
          .addFields(
            { name: 'Prix', value: `${price}€`, inline: true },
            { name: 'Lien', value: `[Acheter maintenant](${productUrl})`, inline: true }
          )
          .setColor('#00FF00');
        message.channel.send({ embeds: [embed] });
      } else {
        message.reply('Aucun produit trouvé.');
      }
    } else {
      message.reply('Erreur lors de la recherche.');
    }
  }

  // Commande pour stopper la surveillance
  if (message.content.startsWith('-stop_monitoring')) {
    if (!isAdmin(member)) {
      message.reply('Seuls les administrateurs peuvent utiliser cette commande.');
      return;
    }

    stopMonitoring();
    message.reply('Toutes les surveillances ont été temporairement arrêtées.');
  }

  // Commande pour démarrer la surveillance
  if (message.content.startsWith('-start_monitoring')) {
    if (!isAdmin(member)) {
      message.reply('Seuls les administrateurs peuvent utiliser cette commande.');
      return;
    }

    startMonitoring();
    message.reply('La surveillance des produits a démarré.');
  }

  // Commande pour vérifier le statut du bot
  if (message.content.startsWith('-status')) {
    const totalProducts = productCache.size;
    const totalDeals = dealWatchList.size;
    const statusMessage = `
      **Statut du Bot :**
      - Produits surveillés : ${totalProducts}
      - Deals actifs : ${totalDeals}
      - Intervalle EDP : ${CHECK_INTERVAL_EDP} ms
      - Intervalle Ventes Flash : ${CHECK_INTERVAL_VENTE_FLASH} ms
      - Intervalle autres produits : ${CHECK_INTERVAL_OTHER} ms
    `;
    message.reply(statusMessage);
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

// Fonction pour démarrer la surveillance
function startMonitoring() {
  monitoringInterval = setInterval(monitorAmazonProducts, CHECK_INTERVAL_OTHER);
  dealInterval = setInterval(monitorDeals, CHECK_INTERVAL_OTHER);
}

// Fonction pour arrêter la surveillance
function stopMonitoring() {
  clearInterval(monitoringInterval);
  clearInterval(dealInterval);
}

// Sauvegarder le cache à intervalles réguliers
setInterval(saveCache, 60000); // Sauvegarder toutes les minutes

// Surveillance des produits Amazon, incluant la pagination et les ventes flash
async function monitorAmazonProducts() {
  const promises = AMAZON_URLS.map(async (url) => {
    try {
      await throttleRequests();
      await monitorPage(url, 1, MAX_PAGES); // Limite à MAX_PAGES pages pour éviter des boucles infinies
    } catch (error) {
      logMessage(`Erreur lors de la récupération des produits de l'URL ${url}: ${error.message}`);
    }
  });
  await Promise.all(promises); // Exécuter toutes les requêtes en parallèle
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

// Fonction pour limiter les requêtes (throttling)
async function throttleRequests() {
  throttleCount++;
  if (throttleCount >= THROTTLE_LIMIT) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Attendre une seconde après chaque batch
    throttleCount = 0;
  }
}

// Fonction pour parcourir plusieurs pages de résultats Amazon
async function monitorPage(url, page, maxPages) {
  if (page > maxPages) return; // Limite le nombre de pages à parcourir

  const paginatedUrl = `${url}&page=${page}`;
  const html = await fetchAmazonPage(paginatedUrl);
  if (!html) return;

  const $ = cheerio.load(html);

  $('.s-main-slot .s-result-item').each(async (i, element) => {
    const productTitle = $(element).find('h2 a span').text();
    const priceWholeText = $(element).find('.a-price-whole').text();
    const priceFractionText = $(element).find('.a-price-fraction').text();
    const price = parseFloat(`${priceWholeText.replace(/\s/g, '').replace(',', '.')}.${priceFractionText}`);
    
    const oldPriceText = $(element).find('.a-text-price .a-offscreen').first().text();
    const oldPrice = parseFloat(oldPriceText.replace(/\s/g, '').replace(',', '.'));
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

      // Envoi des notifications DM personnalisées si activées
      userNotifications.forEach(async (prefs, userId) => {
        if (prefs.category.toLowerCase() === 'promo' && totalPrice >= prefs.minPrice && totalPrice <= prefs.maxPrice) {
          try {
            const user = await client.users.fetch(userId);
            if (user) {
              await user.send(`Produit intéressant détecté: **${productTitle}** - Prix: ${totalPrice.toFixed(2)}€\n[Voir sur Amazon](${productUrl})`);
            }
          } catch (error) {
            logMessage(`Erreur lors de l'envoi du DM à l'utilisateur ${userId}: ${error.message}`);
          }
        }
      });

      if (discountPercentage >= PROMO_THRESHOLD) {
        sendProductToChannel(productTitle, totalPrice.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, 'promo');
      }
      if (totalPrice <= PRICE_THRESHOLD) {
        sendProductToChannel(productTitle, totalPrice.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, '2euro');
      }
      if (totalPrice <= PRICE_THRESHOLD_1_EURO) {
        sendProductToChannel(productTitle, totalPrice.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, '1euro');
      }
      if (discountPercentage >= EDP_THRESHOLD) {
        sendProductToChannel(productTitle, totalPrice.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, 'EDP');
      }

      // Détection des ventes flash
      const flashDealText = $(element).find('.dealBadge').text();
      if (flashDealText.toLowerCase().includes('vente flash')) {
        sendProductToChannel(productTitle, totalPrice.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, 'vente_flash');
      }

      addProductToCache(productUrl, totalPrice);
    }
  });

  // Vérifier s'il y a une page suivante et la parcourir si elle existe
  const nextPage = $('.s-pagination-next');
  if (nextPage && !nextPage.hasClass('s-pagination-disabled')) {
    await monitorPage(url, page + 1, maxPages); // Passe à la page suivante
  }
}

// Surveillance des produits ajoutés manuellement avec `-add_deal`
async function monitorDeals() {
  setInterval(async () => {
    for (const [url, maxPrice] of dealWatchList.entries()) {
      try {
        await throttleRequests();
        const html = await fetchAmazonPage(url);
        if (!html) continue;

        const $ = cheerio.load(html);
        const priceWholeText = $('.a-price-whole').first().text();
        const priceFractionText = $('.a-price-fraction').first().text();
        const price = parseFloat(`${priceWholeText.replace(/\s/g, '').replace(',', '.')}.${priceFractionText}`);
        
        if (price <= maxPrice) {
          sendProductToChannel('Produit surveillé', price.toFixed(2), maxPrice, 0, url, '', 'deal');
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
    if (error.response) {
      logMessage(`Code d'erreur HTTP : ${error.response.status}`);
    }
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

// Sauvegarde du cache lors de la fermeture du bot
process.on('SIGINT', () => {
  saveCache();
  console.log('Cache sauvegardé. Fermeture du bot.');
  process.exit();
});

client.login(process.env.TOKEN);
