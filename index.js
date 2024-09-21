const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();
const fs = require('fs');

// Discord Client Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ]
});

// Rôles réservés
const ADMIN_ROLE_ID = '1286008484776775753';
const PREMIUM_ROLE_ID = 'ID_DU_ROLE_PREMIUM';
const MODO_ROLE_ID = 'ID_DU_ROLE_MODO';
const VISITEUR_ROLE_ID = 'ID_DU_ROLE_VISITEUR';

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
  'electromenager': 'ID_DU_SALON_ELECTROMENAGER',
  'entretien': 'ID_DU_SALON_ENTRETIEN',
  'livre': 'ID_DU_SALON_LIVRE',
  'jouet': 'ID_DU_SALON_JOUET',
  'enfant': 'ID_DU_SALON_ENFANT'
};

// Paramètres du bot
let MAX_PAGES = 5;
let DELAY_BETWEEN_URLS = 180000; // 3 minutes entre chaque requête
let currentProxy = ''; // Stocker le proxy utilisé

const productCache = new Map();
const logsChannelId = '1285977835365994506';

// Liste de plusieurs User-Agents pour éviter d'être bloqué
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.121 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.150 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
];

// Fonction pour obtenir un User-Agent aléatoire
function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Fonction pour obtenir un proxy depuis ProxyScrape et filtrer les proxys mal formés
async function getProxyFromProxyScrape() {
  try {
    const response = await axios.get('https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=ipport&format=text');
    const proxies = response.data.split('\n').filter(Boolean); // Filtrer les lignes vides

    if (proxies.length > 0) {
      const newProxy = proxies[Math.floor(Math.random() * proxies.length)];
      const [host, port] = newProxy.split(':'); // Séparer l'IP et le port

      if (port && !isNaN(port) && parseInt(port) > 0 && parseInt(port) < 65536) {
        currentProxy = newProxy; // Prendre un proxy valide
        logMessage(`Nouveau proxy utilisé : ${currentProxy}`);
      } else {
        logMessage(`Proxy mal formé ou port invalide : ${newProxy}, en sélectionnant un autre.`);
        await getProxyFromProxyScrape(); // Réessayer si le proxy est mal formé ou invalide
      }
    } else {
      logMessage('Aucun proxy valide disponible.');
    }
  } catch (error) {
    logMessage('Erreur lors de la récupération des proxys: ' + error.message);
  }
}

// Charger le cache
function loadCache() {
  if (fs.existsSync('cache.json')) {
    const data = fs.readFileSync('cache.json');
    const parsed = JSON.parse(data);
    parsed.forEach(([key, value]) => productCache.set(key, value));
  }
}

// Sauvegarder le cache
function saveCache() {
  const data = JSON.stringify([...productCache]);
  fs.writeFileSync('cache.json', data);
}

// Démarrer la surveillance
async function startMonitoring() {
  logMessage('Démarrage de la surveillance des produits Amazon...');
  await getProxyFromProxyScrape(); // Obtenir un proxy avant de commencer

  const generalSearchUrl = 'https://www.amazon.fr/deals';

  productCache.set(generalSearchUrl, 'EDP');
  productCache.set(generalSearchUrl, 'Autre_vendeur');
  productCache.set(generalSearchUrl, 'promo');
  productCache.set(generalSearchUrl, 'vente_flash');

  productCache.set('https://www.amazon.fr/s?k=pas+cher', '1euro');
  productCache.set('https://www.amazon.fr/s?k=pas+cher', '2euro');
  productCache.set('https://www.amazon.fr/s?k=electromenager', 'electromenager');
  productCache.set('https://www.amazon.fr/s?k=entretien', 'entretien');
  productCache.set('https://www.amazon.fr/s?k=livre', 'livre');
  productCache.set('https://www.amazon.fr/s?k=jouet', 'jouet');
  productCache.set('https://www.amazon.fr/s?k=enfant', 'enfant');

  logMessage(`Nombre d'URLs dans le cache : ${productCache.size}`);

  await monitorAmazonProducts();
}

// À l'initialisation du bot
client.once('ready', () => {
  logMessage(`Connecté en tant que ${client.user.tag}`);
  loadCache();
  startMonitoring();
});

// Surveillance des produits Amazon avec une pause de 3 minutes entre chaque URL
async function monitorAmazonProducts() {
  if (productCache.size === 0) {
    logMessage('Aucune URL de produit trouvée dans le cache. Veuillez ajouter des produits à surveiller.');
    return;
  }

  logMessage('Début de la surveillance des produits Amazon...');

  for (const [url, category] of productCache.entries()) {
    try {
      logMessage(`Tentative de scraping de l'URL : ${url} pour la catégorie : ${category}`);
      const html = await fetchAmazonPage(url);
      if (html) {
        logMessage(`Scraping réussi pour l'URL : ${url}`);
        await monitorPage(url, 1, MAX_PAGES, category);
      } else {
        logMessage(`Scraping échoué pour l'URL : ${url}`);
      }
    } catch (error) {
      logMessage(`Erreur lors de la récupération des produits de l'URL ${url}: ${error.message}`);
    }

    logMessage(`Pause de 3 minutes avant de scraper l'URL suivante...`);
    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_URLS)); // Pause de 3 minutes
  }

  logMessage('Surveillance des produits terminée.');
}

// Scraping des pages
async function monitorPage(url, page, maxPages, category) {
  if (page > maxPages) return;

  const paginatedUrl = url === 'https://www.amazon.fr/deals' ? url : `${url}&page=${page}`;
  logMessage(`Scraping de la page ${page} de l'URL ${paginatedUrl} pour la catégorie ${category}`);

  const html = await fetchAmazonPage(paginatedUrl);
  if (!html) {
    logMessage(`Impossible de récupérer la page ${page} de l'URL ${url}`);
    return;
  }

  const $ = cheerio.load(html);

  let productsFound = 0;
  $('.s-main-slot .s-result-item').each(async (i, element) => {
    const productTitle = $(element).find('h2 a span').text();
    const priceWholeText = $(element).find('.a-price-whole').text();
    const priceFractionText = $(element).find('.a-price-fraction').text();
    const price = parseFloat(`${priceWholeText.replace(/\s/g, '').replace(',', '.')}.${priceFractionText}`);

    const oldPriceText = $(element).find('.a-text-price .a-offscreen').first().text();
    const oldPrice = parseFloat(oldPriceText.replace(/\s/g, '').replace(',', '.'));
    const productUrl = 'https://www.amazon.fr' + $(element).find('h2 a').attr('href');
    const productImage = $(element).find('img').attr('src');

    if (price && oldPrice) {
      const discountPercentage = ((oldPrice - price) / oldPrice) * 100;
      logMessage(`Produit trouvé : ${productTitle}, Prix : ${price}, Ancien prix : ${oldPrice}, Réduction : ${discountPercentage}%, ajouter dans le salon ${category}`);

      productsFound++;

      if (category === 'EDP' && discountPercentage >= 80) {
        sendProductToChannel(productTitle, price.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, category);
      } else if (category === 'Autre_vendeur' && isOtherSellerBetter($, element)) {
        sendProductToChannel(productTitle, price.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, category);
      } else if (category === 'promo' && (isPromo($, element) || hasMultipleCoupons($, element))) {
        sendProductToChannel(productTitle, price.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, category);
      } else if (category === 'vente_flash' && isFlashSale($, element)) {
        sendProductToChannel(productTitle, price.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, category);
      }
    }
  });

  logMessage(`Produits trouvés sur la page ${page} pour la catégorie ${category} : ${productsFound}`);

  const nextPage = $('.s-pagination-next');
  if (nextPage && !nextPage.hasClass('s-pagination-disabled') && url !== 'https://www.amazon.fr/deals') {
    await monitorPage(url, page + 1, maxPages, category);
  }
}

// Fonction pour récupérer les pages Amazon avec un proxy et User-Agent aléatoire
async function fetchAmazonPage(url, retries = 0) {
  if (!url || url.trim() === '') {
    logMessage(`Erreur: URL vide ou incorrecte: ${url}`);
    return null;
  }

  const proxy = currentProxy ? { host: currentProxy.split(':')[0], port: currentProxy.split(':')[1] } : null;
  const options = {
    headers: {
      'User-Agent': getRandomUserAgent(), // Utilisation d'un User-Agent aléatoire
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    proxy: proxy // Utilisation du proxy aléatoire récupéré
  };

  try {
    logMessage(`Tentative de récupération de l'URL : ${url} avec proxy ${currentProxy}`);
    const { data } = await axios.get(url, options);
    logMessage(`Page récupérée avec succès pour ${url}`);
    return data;
  } catch (error) {
    logMessage(`Erreur lors de la récupération de l'URL ${url}: ${error.message}`);
    if (error.response) {
      logMessage(`Code d'erreur HTTP : ${error.response.status}`);
    }
    if (retries < 5) {
      const delay = 10000 * (retries + 1);
      logMessage(`Nouvelle tentative pour accéder à ${url}, tentative ${retries + 1} après ${delay / 1000} secondes`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchAmazonPage(url, retries + 1);
    }
    logMessage(`Échec après plusieurs tentatives pour accéder à ${url}: ${error.message}`);
    return null;
  }
}

// Fonction pour envoyer un produit au salon approprié
function sendProductToChannel(title, price, oldPrice, discount, url, imageUrl, category) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setURL(url)
    .setImage(imageUrl)
    .addFields(
      { name: 'Prix actuel', value: `${price} €`, inline: true },
      { name: 'Ancien prix', value: `${oldPrice} €`, inline: true },
      { name: 'Réduction', value: `${discount}%`, inline: true }
    )
    .setColor('#ff9900')
    .setTimestamp();

  const channel = client.channels.cache.get(channelCategories[category]);
  if (channel) {
    channel.send({ embeds: [embed] });
  } else {
    logMessage(`Erreur : salon non trouvé pour la catégorie ${category}`);
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
  logMessage('Cache sauvegardé. Fermeture du bot.');
  process.exit();
});

client.login(process.env.TOKEN);
