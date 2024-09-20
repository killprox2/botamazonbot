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

// Rôles réservés
const ADMIN_ROLE_ID = '1286008484776775753'; // Remplacez par l'ID du rôle administrateur
const PREMIUM_ROLE_ID = 'ID_DU_ROLE_PREMIUM'; // Remplacez par l'ID du rôle premium
const MODO_ROLE_ID = 'ID_DU_ROLE_MODO'; // Remplacez par l'ID du rôle modo
const VISITEUR_ROLE_ID = 'ID_DU_ROLE_VISITEUR'; // Remplacez par l'ID du rôle visiteur

// Gestion des rôles par réaction d'emoji
const roleAssignments = {
  '💰': '1286277846754525194', // EDP
  '📦': '1286277915515949096', // Autre vendeur
  '🟢': '1286277613559742538', // 2€
  '🔵': '1286277434450120714', // 1€
  '🔥': '1286277883781709824', // Promo
  '⚡': '1286306479275511890'  // Vente flash
};

// Catégories des salons
const channelCategories = {
  'EDP': '1285953900066902057',
  'promo': '1285969661535453215',
  '2euro': '1285939619598172232',
  '1euro': '1255863140974071893',
  'Autre_vendeur': '1285974003307118644',
  'deal': '1285955371252580352',
  'vente_flash': '1286281265825321023',
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

// Surveillance des produits Amazon
async function monitorAmazonProducts() {
  const promises = [...productCache.keys()].map(async (url) => {
    try {
      const html = await fetchAmazonPage(url);
      if (html) {
        await monitorPage(url, 1, MAX_PAGES);
      }
    } catch (error) {
      logMessage(`Erreur lors de la récupération des produits de l'URL ${url}: ${error.message}`);
    }
  });
  await Promise.all(promises);
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

    if (!isProductInCache(productUrl) && price && oldPrice) {
      const discountPercentage = ((oldPrice - price) / oldPrice) * 100;

      // Salon 1€ : Prix <= 1€ et réduction minimum de 50%
      if (price <= 1 && discountPercentage >= 50) {
        sendProductToChannel(productTitle, price.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, '1euro');
      }
      // Salon 2€ : Prix <= 2€ et réduction minimum de 50%
      else if (price <= 2 && discountPercentage >= 50) {
        sendProductToChannel(productTitle, price.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, '2euro');
      }
      // Salon Promo : Réduction >= 30%
      else if (discountPercentage >= 30) {
        sendProductToChannel(productTitle, price.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, 'promo');
      }
      // Salon Vente Flash : Vente flash détectée
      else if (isFlashSale(element)) {
        sendProductToChannel(productTitle, price.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, 'vente_flash');
      }
      // Salon EDP : Réduction >= 80% ou plusieurs coupons
      else if (discountPercentage >= 80 || hasMultipleCoupons(element)) {
        sendProductToChannel(productTitle, price.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, 'EDP');
      }
      // Salon Autre Vendeur : Prix autre vendeur beaucoup plus bas
      else if (isOtherSellerBetter(element)) {
        sendProductToChannel(productTitle, price.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, 'Autre_vendeur');
      }

      addProductToCache(productUrl, price);
    }
  });

  const nextPage = $('.s-pagination-next');
  if (nextPage && !nextPage.hasClass('s-pagination-disabled')) {
    await monitorPage(url, page + 1, maxPages);
  }
}

// Détecter si une vente flash est en cours
function isFlashSale(element) {
  return $(element).find('.a-deal-badge').length > 0;
}

// Vérifier si plusieurs coupons sont applicables
function hasMultipleCoupons(element) {
  return $(element).find('.couponBadge').length > 1;
}

// Vérifier si le prix d'un autre vendeur est meilleur
function isOtherSellerBetter(element) {
  const otherSellerPriceText = $(element).find('.olpOfferPrice').first().text();
  if (otherSellerPriceText) {
    const otherSellerPrice = parseFloat(otherSellerPriceText.replace(/\s/g, '').replace(',', '.'));
    const mainPriceText = $(element).find('.a-price-whole').first().text();
    const mainPrice = parseFloat(mainPriceText.replace(/\s/g, '').replace(',', '.'));
    return otherSellerPrice < mainPrice;
  }
  return false;
}

// Envoi du produit dans le salon approprié
function sendProductToChannel(title, price, oldPrice, discountPercentage, url, image, category) {
  const channelId = channelCategories[category];
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

// Surveillance des produits ajoutés manuellement avec `-add_deal`
async function monitorDeals() {
  for (const [url, maxPrice] of dealWatchList.entries()) {
    try {
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

loadCache(); // Charge le cache au démarrage

client.login(process.env.TOKEN); // Assurez-vous que le token est défini dans un fichier .env
