const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration du bot Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions, 
  ]
});

// Identifiants des rôles et des canaux à attribuer
const channelMentions = {
  'EDP': '<@&ID_DU_ROLE_EDP>',
  'Autre_vendeur': '<@&ID_DU_ROLE_AUTRE_VENDEUR>',
  '2euro': '<@&ID_DU_ROLE_2EURO>',
  '1euro': '<@&ID_DU_ROLE_1EURO>',
  'promo': '<@&ID_DU_ROLE_PROMO>'
};

// Constantes pour les seuils et URLs d'Amazon
const AMAZON_URLS = [
  'https://www.amazon.fr/s?k=promo',
  'https://www.amazon.fr/s?k=beauté&rh=p_36%3A-100',
  'https://www.amazon.fr/s?k=jouets&rh=p_36%3A-100',
  'https://www.amazon.fr/s?k=livres&rh=p_36%3A-100',
];

const PRICE_THRESHOLD = 2;
const PRICE_THRESHOLD_1_EURO = 1;
const PROMO_THRESHOLD = 5;  
const EDP_THRESHOLD = 90;
const DISCOUNT_THRESHOLD = 80;
const CHECK_INTERVAL = 300000; 
const CACHE_EXPIRY_TIME = 60 * 60 * 1000;

const productCache = new Map();

// Fonction pour ajouter un produit au cache
function addProductToCache(url) {
  productCache.set(url, Date.now());
  setTimeout(() => productCache.delete(url), CACHE_EXPIRY_TIME);
}

// Fonction pour vérifier si un produit est déjà dans le cache
function isProductInCache(url) {
  return productCache.has(url);
}

// Fonction principale
client.once('ready', () => {
  console.log(`Bot is logged in as ${client.user.tag}`);
  const logsChannel = client.channels.cache.get('1285977835365994506');

  if (logsChannel) {
    logsChannel.send(`Le bot a démarré et surveille maintenant les produits Amazon.`);
  }

  monitorAmazonProducts(logsChannel);
});

// Fonction pour effectuer la requête Amazon
async function fetchAmazonPage(url, retries = 0) {
  try {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      }
    };

    const { data } = await axios.get(url, options);
    return data;
  } catch (error) {
    if (error.response && error.response.status === 503 && retries < 5) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return fetchAmazonPage(url, retries + 1);
    } else {
      throw new Error(`Échec de la récupération des données après ${retries} tentatives.`);
    }
  }
}

// Fonction pour surveiller les produits Amazon
async function monitorAmazonProducts(logsChannel) {
  try {
    for (const url of AMAZON_URLS) {
      if (logsChannel) {
        logsChannel.send(`Recherche de produits sur Amazon : ${url}`);
      }

      const html = await fetchAmazonPage(url);
      const $ = cheerio.load(html);

      const promoProducts = [];
      const oneEuroProducts = [];
      const twoEuroProducts = [];
      const edpProducts = [];

      $('.s-main-slot .s-result-item').each((i, element) => {
        const productTitle = $(element).find('h2 a span').text();
        const priceText = $(element).find('.a-price-whole').text();
        const price = parseFloat(priceText.replace(',', '.'));
        const oldPriceText = $(element).find('.a-text-price .a-offscreen').first().text();
        const oldPrice = parseFloat(oldPriceText.replace(',', '.'));
        const productUrl = 'https://www.amazon.fr' + $(element).find('h2 a').attr('href');
        const productImage = $(element).find('img').attr('src');

        // Calcul du prix total avec livraison (si applicable)
        let shippingCost = 0;
        const shippingText = $(element).find('.a-color-secondary .a-size-small').text();
        if (shippingText.toLowerCase().includes('livraison')) {
          const shippingCostText = shippingText.match(/(\d+,\d+)/);
          if (shippingCostText) {
            shippingCost = parseFloat(shippingCostText[0].replace(',', '.'));
          }
        }
        const totalPrice = price + shippingCost;

        if (totalPrice && oldPrice) {
          const discountPercentage = ((oldPrice - totalPrice) / oldPrice) * 100;

          if (discountPercentage >= PROMO_THRESHOLD && !isProductInCache(productUrl)) {
            promoProducts.push({ title: productTitle, price: totalPrice, oldPrice, discountPercentage, url: productUrl, image: productImage });
            addProductToCache(productUrl);
          }

          if (totalPrice <= PRICE_THRESHOLD && discountPercentage >= DISCOUNT_THRESHOLD && !isProductInCache(productUrl)) {
            twoEuroProducts.push({ title: productTitle, price: totalPrice, oldPrice, discountPercentage, url: productUrl, image: productImage });
            addProductToCache(productUrl);
          }

          if (totalPrice <= PRICE_THRESHOLD_1_EURO && !isProductInCache(productUrl)) {
            oneEuroProducts.push({ title: productTitle, price: totalPrice, oldPrice, discountPercentage, url: productUrl, image: productImage });
            addProductToCache(productUrl);
          }

          if (discountPercentage >= EDP_THRESHOLD && !isProductInCache(productUrl)) {
            edpProducts.push({ title: productTitle, price: totalPrice, oldPrice, discountPercentage, url: productUrl, image: productImage });
            addProductToCache(productUrl);
          }
        }
      });

      sendProductsToChannels(promoProducts, oneEuroProducts, twoEuroProducts, edpProducts);
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
    }
  } catch (error) {
    console.error('Erreur lors de la récupération des produits:', error.message);
  }
}

// Fonction pour envoyer les produits dans les bons canaux
function sendProductsToChannels(promoProducts, oneEuroProducts, twoEuroProducts, edpProducts) {
  const promoChannel = client.channels.cache.get('1285969661535453215');
  const oneEuroChannel = client.channels.cache.get('1255863140974071893');
  const edpChannel = client.channels.cache.get('1285953900066902057');
  const twoEuroChannel = client.channels.cache.get('1285927841577439232');

  promoProducts.forEach(product => sendEmbed(promoChannel, product, 'Produit en promotion', channelMentions['promo']));
  oneEuroProducts.forEach(product => sendEmbed(oneEuroChannel, product, 'Produit à 1 € ou moins', channelMentions['1euro']));
  twoEuroProducts.forEach(product => sendEmbed(twoEuroChannel, product, 'Produit à moins de 2 €', channelMentions['2euro']));
  edpProducts.forEach(product => sendEmbed(edpChannel, product, 'Erreur de prix détectée', channelMentions['EDP']));
}

// Fonction pour envoyer un embed dans un canal
function sendEmbed(channel, product, description, mention) {
  if (channel) {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(product.title)
      .setURL(product.url)
      .setDescription(`${description} avec une réduction de ${Math.round(product.discountPercentage)}%`)
      .setThumbnail(product.image)
      .addFields(
        { name: 'Prix total', value: `${product.price}€ (avec livraison)`, inline: true },
        { name: 'Prix habituel', value: `${product.oldPrice}€`, inline: true },
        { name: 'Lien', value: `[Acheter maintenant](${product.url})`, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Powered by your Amazon Bot' });

    channel.send({ content: mention, embeds: [embed] });
  }
}

const token = process.env.TOKEN;
client.login(token);
