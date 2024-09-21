const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const puppeteer = require('puppeteer');
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
let MAX_PAGES = 10;
let DELAY_BETWEEN_URLS = 300000; // 5 minutes entre chaque requête

const productCache = new Map();
const logsChannelId = '1285977835365994506';

// Fonction pour utiliser Puppeteer et scrapper la page avec le JavaScript activé
async function fetchPageWithPuppeteer(url) {
  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2' }); // Attend que le réseau soit inactif pour charger complètement la page
    const content = await page.content();
    await browser.close();
    return content;
  } catch (error) {
    logMessage(`Erreur avec Puppeteer : ${error.message}`);
    return null;
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

  // URL spécifique pour le salon "vente_flash"
  const venteFlashUrl = 'https://www.amazon.fr/deals';
  productCache.set(venteFlashUrl, 'vente_flash');

  // Pour les autres catégories, recherche intelligente sur Amazon
  const amazonSearchBaseUrl = 'https://www.amazon.fr/s?k=';
  productCache.set(`${amazonSearchBaseUrl}electromenager`, 'electromenager');
  productCache.set(`${amazonSearchBaseUrl}entretien`, 'entretien');
  productCache.set(`${amazonSearchBaseUrl}livre`, 'livre');
  productCache.set(`${amazonSearchBaseUrl}jouet`, 'jouet');
  productCache.set(`${amazonSearchBaseUrl}enfant`, 'enfant');
  productCache.set(`${amazonSearchBaseUrl}pas+cher`, '1euro');
  productCache.set(`${amazonSearchBaseUrl}pas+cher`, '2euro');
  productCache.set(`${amazonSearchBaseUrl}promo`, 'promo');
  productCache.set(`${amazonSearchBaseUrl}Autre+vendeur`, 'Autre_vendeur');
  productCache.set(`${amazonSearchBaseUrl}EDP`, 'EDP');

  logMessage(`Nombre d'URLs dans le cache : ${productCache.size}`);

  await monitorAmazonProducts();
}

// À l'initialisation du bot
client.once('ready', () => {
  logMessage(`Connecté en tant que ${client.user.tag}`);
  loadCache();
  startMonitoring();
});

// Surveillance des produits Amazon
async function monitorAmazonProducts() {
  if (productCache.size === 0) {
    logMessage('Aucune URL de produit trouvée dans le cache. Veuillez ajouter des produits à surveiller.');
    return;
  }

  logMessage('Début de la surveillance des produits Amazon...');

  for (const [url, category] of productCache.entries()) {
    try {
      logMessage(`Tentative de scraping de l'URL : ${url} pour la catégorie : ${category}`);
      const html = await fetchPageWithPuppeteer(url);
      if (html) {
        logMessage(`Scraping réussi pour l'URL : ${url}`);
        await monitorPage(html, category);
      } else {
        logMessage(`Scraping échoué pour l'URL : ${url}`);
      }
    } catch (error) {
      logMessage(`Erreur lors de la récupération des produits de l'URL ${url}: ${error.message}`);
    }

    logMessage(`Pause de 5 minutes avant de scraper l'URL suivante...`);
    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_URLS));
  }

  logMessage('Surveillance des produits terminée.');
}

// Scraping des pages récupérées avec Puppeteer
async function monitorPage(html, category) {
  const $ = require('cheerio').load(html);
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

      sendProductToChannel(productTitle, price.toFixed(2), oldPrice.toFixed(2), discountPercentage, productUrl, productImage, category);
    }
  });

  logMessage(`Produits trouvés pour la catégorie ${category} : ${productsFound}`);
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
