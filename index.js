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
  'electromenager': 'ID_DU_SALON_ELECTROMENAGER',
  'entretien': 'ID_DU_SALON_ENTRETIEN',
  'livre': 'ID_DU_SALON_LIVRE',
  'jouet': 'ID_DU_SALON_JOUET',
  'enfant': 'ID_DU_SALON_ENFANT'
};

// Configuration dynamique des paramètres du bot
let MAX_PAGES = 5;
let CHECK_INTERVAL = 600000; // 10 minutes (600 000 millisecondes)

const productCache = new Map();
const dealWatchList = new Map(); // Liste des "deals" à surveiller manuellement
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

// Fonction pour démarrer la surveillance
function startMonitoring() {
  logMessage('Démarrage de la surveillance des produits Amazon...');

  // Surveillance avancée sur tout Amazon pour EDP, Autre-vendeur, Promo, et Vente-flash
  const generalSearchUrl = 'https://www.amazon.fr/s?k='; // Recherche générale

  productCache.set(generalSearchUrl, 'EDP'); // Recherche générale pour EDP
  productCache.set(generalSearchUrl, 'Autre_vendeur'); // Recherche générale pour Autre-vendeur
  productCache.set(generalSearchUrl, 'promo'); // Recherche générale pour Promo
  productCache.set(generalSearchUrl, 'vente_flash'); // Recherche générale pour Vente-flash

  // Ajouter des URL spécifiques à surveiller pour d'autres catégories
  productCache.set('https://www.amazon.fr/s?k=pas+cher', '1euro');
  productCache.set('https://www.amazon.fr/s?k=pas+cher', '2euro');
  productCache.set('https://www.amazon.fr/s?k=electromenager', 'electromenager');
  productCache.set('https://www.amazon.fr/s?k=entretien', 'entretien');
  productCache.set('https://www.amazon.fr/s?k=livre', 'livre');
  productCache.set('https://www.amazon.fr/s?k=jouet', 'jouet');
  productCache.set('https://www.amazon.fr/s?k=enfant', 'enfant');
  
  logMessage(`Nombre d'URLs dans le cache : ${productCache.size}`);

  monitoringInterval = setInterval(monitorAmazonProducts, CHECK_INTERVAL); // Surveillance toutes les 10 minutes
  dealInterval = setInterval(monitorDeals, CHECK_INTERVAL); // Surveillance des deals toutes les 10 minutes
  logMessage('Surveillance démarrée.');
}

// Fonction pour arrêter la surveillance
function stopMonitoring() {
  clearInterval(monitoringInterval);
  clearInterval(dealInterval);
  logMessage('Moniteur arrêté.');
}

// Ajoute cet événement pour démarrer le moniteur au lancement du bot
client.once('ready', () => {
  logMessage(`Connecté en tant que ${client.user.tag}`);
  loadCache(); // Charger le cache au démarrage
  startMonitoring(); // Démarre la surveillance immédiatement
});

// Surveillance des produits Amazon
async function monitorAmazonProducts() {
  if (productCache.size === 0) {
    logMessage('Aucune URL de produit trouvée dans le cache. Veuillez ajouter des produits à surveiller.');
    return;
  }

  logMessage('Début de la surveillance des produits Amazon...');
  const promises = [...productCache.entries()].map(async ([url, category]) => {
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
  });
  await Promise.all(promises);
  logMessage('Surveillance des produits terminée.');
}

// Fonction pour surveiller les deals ajoutés manuellement
async function monitorDeals() {
  if (dealWatchList.size === 0) {
    logMessage('Aucun deal à surveiller.');
    return;
  }

  logMessage('Début de la surveillance des deals...');
  const promises = [...dealWatchList.entries()].map(async ([url, maxPrice]) => {
    try {
      logMessage(`Surveillance du deal à l'URL : ${url} avec prix maximum de ${maxPrice}`);
      const html = await fetchAmazonPage(url);
      if (html) {
        const $ = cheerio.load(html);
        const priceWholeText = $('.a-price-whole').first().text();
        const priceFractionText = $('.a-price-fraction').first().text();
        const price = parseFloat(`${priceWholeText.replace(/\s/g, '').replace(',', '.')}.${priceFractionText}`);
        if (price <= maxPrice) {
          logMessage(`Deal trouvé : ${url} avec un prix de ${price}`);
          sendProductToChannel('Produit surveillé', price.toFixed(2), maxPrice, 0, url, '', 'deal');
        } else {
          logMessage(`Prix actuel ${price} supérieur au prix maximum ${maxPrice} pour l'URL : ${url}`);
        }
      } else {
        logMessage(`Scraping échoué pour l'URL : ${url}`);
      }
    } catch (error) {
      logMessage(`Erreur lors de la surveillance du deal pour l'URL ${url}: ${error.message}`);
    }
  });
  await Promise.all(promises);
  logMessage('Surveillance des deals terminée.');
}

// Fonction pour parcourir plusieurs pages de résultats Amazon
async function monitorPage(url, page, maxPages, category) {
  if (page > maxPages) return; // Limite le nombre de pages à parcourir

  const paginatedUrl = `${url}&page=${page}`;
  logMessage(`Scraping de la page ${page} de l'URL ${paginatedUrl} pour la catégorie ${category}`);

  const html = await fetchAmazonPage(paginatedUrl);
  if (!html) {
    logMessage(`Impossible de récupérer la page ${page} de l'URL ${url}`);
    return;
  }

  const $ = cheerio.load(html);  // Initialisation de la variable $ ici

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

      // Gestion avancée pour les catégories spéciales
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
  if (nextPage && !nextPage.hasClass('s-pagination-disabled')) {
    await monitorPage(url, page + 1, maxPages, category);
  }
}

// Vérifie si un autre vendeur propose un meilleur prix
function isOtherSellerBetter($, element) {
  const otherSellerPriceText = $(element).find('.olpOfferPrice').first().text();
  if (otherSellerPriceText) {
    const otherSellerPrice = parseFloat(otherSellerPriceText.replace(/\s/g, '').replace(',', '.'));
    const mainPriceText = $(element).find('.a-price-whole').first().text();
    const mainPrice = parseFloat(mainPriceText.replace(/\s/g, '').replace(',', '.'));
    return otherSellerPrice < mainPrice;
  }
  return false;
}

// Vérifie si un produit est en promo
function isPromo($, element) {
  return $(element).find('.a-price .priceBadging').length > 0;
}

// Détecte si plusieurs coupons sont applicables
function hasMultipleCoupons($, element) {
  return $(element).find('.couponBadge').length > 1;
}

// Détecte si une vente flash est en cours
function isFlashSale($, element) {
  return $(element).find('.a-deal-badge').length > 0;
}

// Fonction pour envoyer un produit dans le salon approprié
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
    logMessage(`Produit envoyé dans le salon ${category}: ${title}`);
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.121 Safari/537.36',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    }
  };

  try {
    logMessage(`Tentative de récupération de l'URL : ${url}`);
    const { data } = await axios.get(url, options);
    logMessage(`Page récupérée avec succès pour ${url}`);
    return data;
  } catch (error) {
    logMessage(`Erreur lors de la récupération de l'URL ${url}: ${error.message}`);
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

// Fonction pour ajouter manuellement un produit à surveiller via la commande -add_deal
client.on('messageCreate', async (message) => {
  const member = message.member;

  if (message.content.startsWith('-add_deal')) {
    const args = message.content.split(' ');
    const productUrl = args[1];
    const maxPrice = parseFloat(args[2]);

    if (!productUrl || isNaN(maxPrice)) {
      message.reply('Veuillez spécifier une URL et un prix maximum.');
      return;
    }

    dealWatchList.set(productUrl, maxPrice);
    message.reply(`Produit ajouté pour surveillance : ${productUrl} avec prix maximum de ${maxPrice}€.`);
  }
});

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


client.login(process.env.TOKEN); // Assurez-vous que le token est défini dans un fichier .env
