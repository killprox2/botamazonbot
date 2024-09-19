const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration du bot Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions, // Intent nécessaire pour gérer les réactions
  ]
});

// Identifiants des rôles et des canaux à attribuer
const roleAssignments = {
  '💰': 'ID_DU_ROLE_EDP', // Emoji pour EDP
  '📦': 'ID_DU_ROLE_AUTRE_VENDEUR', // Emoji pour Autre vendeur
  '🟢': 'ID_DU_ROLE_2EURO', // Emoji pour 2euro
  '🔵': 'ID_DU_ROLE_1EURO', // Emoji pour 1euro
  '🔥': 'ID_DU_ROLE_PROMO' // Emoji pour Promo
};

const channelMentions = {
  'EDP': '<@&ID_DU_ROLE_EDP>',
  'Autre_vendeur': '<@&ID_DU_ROLE_AUTRE_VENDEUR>',
  '2euro': '<@&ID_DU_ROLE_2EURO>',
  '1euro': '<@&ID_DU_ROLE_1EURO>',
  'promo': '<@&ID_DU_ROLE_PROMO>'
};

// Constantes de vérification des produits Amazon
const AMAZON_URL = 'https://www.amazon.fr/s?k=';
const PRICE_THRESHOLD = 2; 
const PRICE_THRESHOLD_1_EURO = 1; 
const PROMO_THRESHOLD = 10; 
const EDP_THRESHOLD = 90; 
const DISCOUNT_THRESHOLD = 80; 
const OTHER_SELLERS_THRESHOLD = 20; 
const CHECK_INTERVAL = 300000; 
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; 
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

// Commande pour afficher l'embed des rôles
client.on('messageCreate', async (message) => {
  if (message.content === '-role') {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Sélection de rôles')
      .setDescription(
        `Cliquez sur les emojis ci-dessous pour obtenir des notifications pour les catégories :
        💰 - Erreur de prix (EDP)
        📦 - Autres vendeurs
        🟢 - Produits à moins de 2€
        🔵 - Produits à moins de 1€
        🔥 - Promotions`
      )
      .setTimestamp();

    const roleMessage = await message.channel.send({ embeds: [embed] });

    // Ajoute les réactions aux emojis pour les rôles
    await roleMessage.react('💰');
    await roleMessage.react('📦');
    await roleMessage.react('🟢');
    await roleMessage.react('🔵');
    await roleMessage.react('🔥');
  }
});

// Gestion des réactions pour ajouter ou retirer les rôles
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  const roleId = roleAssignments[reaction.emoji.name];
  if (roleId) {
    const member = await reaction.message.guild.members.fetch(user.id);
    const role = reaction.message.guild.roles.cache.get(roleId);

    if (role) {
      await member.roles.add(role);
      await user.send(`Le rôle ${role.name} t'a été attribué.`);
    }
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;

  const roleId = roleAssignments[reaction.emoji.name];
  if (roleId) {
    const member = await reaction.message.guild.members.fetch(user.id);
    const role = reaction.message.guild.roles.cache.get(roleId);

    if (role) {
      await member.roles.remove(role);
      await user.send(`Le rôle ${role.name} t'a été retiré.`);
    }
  }
});

// Fonction principale
client.once('ready', () => {
  console.log(`Bot is logged in as ${client.user.tag}`);
  const logsChannel = client.channels.cache.get('1285977835365994506');

  if (logsChannel) {
    logsChannel.send(`Le bot a démarré et surveille maintenant les produits Amazon.`);
  }

  monitorAmazonProducts(logsChannel);
});

// Fonction pour surveiller les produits Amazon et détecter les autres vendeurs
async function monitorAmazonProducts(logsChannel) {
  try {
    while (true) {
      if (logsChannel) {
        logsChannel.send(`Recherche de produits sur Amazon à partir de l'URL : ${AMAZON_URL}`);
      }

      const html = await fetchAmazonPage(AMAZON_URL, logsChannel);
      const $ = cheerio.load(html);

      const products = [];
      const oneEuroProducts = [];
      const promoProducts = [];
      const edpProducts = [];
      const otherSellersProducts = [];

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

          // Ajout dans la liste des promos si la réduction dépasse 10%
          if (discountPercentage >= PROMO_THRESHOLD && !isProductInCache(productUrl)) {
            promoProducts.push({ title: productTitle, price: totalPrice, oldPrice, discountPercentage, url: productUrl, image: productImage });
            addProductToCache(productUrl);
          }

          // Vérification pour les produits à moins de 2 €
          if (totalPrice <= PRICE_THRESHOLD && discountPercentage >= DISCOUNT_THRESHOLD && !isProductInCache(productUrl)) {
            products.push({ title: productTitle, price: totalPrice, oldPrice, discountPercentage, url: productUrl, image: productImage });
            addProductToCache(productUrl);
          }

          // Vérification pour les produits à 1 € ou moins
          if (totalPrice <= PRICE_THRESHOLD_1_EURO && !isProductInCache(productUrl)) {
            oneEuroProducts.push({ title: productTitle, price: totalPrice, oldPrice, discountPercentage, url: productUrl, image: productImage });
            addProductToCache(productUrl);
          }

          // Vérification pour les erreurs de prix (EDP)
          if (discountPercentage >= EDP_THRESHOLD && !isProductInCache(productUrl)) {
            edpProducts.push({ title: productTitle, price: totalPrice, oldPrice, discountPercentage, url: productUrl, image: productImage });
            addProductToCache(productUrl);
          }
        }
      });

      // Envoi des produits dans les canaux appropriés (promo, < 2€, etc.)
      sendProductsToChannels(products, oneEuroProducts, promoProducts, edpProducts);

      // Pause avant la prochaine vérification
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
    }
  } catch (error) {
    if (logsChannel) {
      logsChannel.send(`Erreur lors de la récupération des produits : ${error.message || error}`);
    }
    console.error('Erreur lors de la récupération des produits:', error.message || error);
  }
}

// Fonction pour envoyer les produits dans les bons canaux
function sendProductsToChannels(products, oneEuroProducts, promoProducts, edpProducts) {
  const promoChannel = client.channels.cache.get('1285969661535453215');
  const oneEuroChannel = client.channels.cache.get('1285939619598172232');
  const edpChannel = client.channels.cache.get('1285953900066902057');
  const productsChannel = client.channels.cache.get('1285927841577439232');

  // Envoi des produits à moins de 2 €
  products.forEach((product) => sendEmbed(productsChannel, product, 'Produit en promotion', channelMentions['2euro']));

  // Envoi des produits à 1 € ou moins
  oneEuroProducts.forEach((product) => sendEmbed(oneEuroChannel, product, 'Produit à 1 € ou moins', channelMentions['1euro']));

  // Envoi des produits en promo
  promoProducts.forEach((product) => sendEmbed(promoChannel, product, 'Produit en promotion', channelMentions['promo']));

  // Envoi des produits avec erreur de prix
  edpProducts.forEach((product) => sendEmbed(edpChannel, product, 'Erreur de prix détectée', channelMentions['EDP']));
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
