const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');

// Configuration du bot Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // Important pour accéder au contenu des messages
  ]
});

const AMAZON_URL = 'https://www.amazon.fr/s?k='; // Recherche sur tout Amazon
const PRICE_THRESHOLD = 2; // Prix maximum pour la première vérification (produits à moins de 2 €)
const PRICE_THRESHOLD_1_EURO = 1; // Prix maximum pour la seconde vérification (produits à 1 € ou moins)
const PROMO_THRESHOLD = 10; // Seuil pour détecter une promotion (10% de réduction)
const EDP_THRESHOLD = 90; // Seuil pour les erreurs de prix (90% de réduction)
const DISCOUNT_THRESHOLD = 80; // Seuil de réduction minimum pour les produits normaux (80%)
const OTHER_SELLERS_THRESHOLD = 20; // Seuil de réduction des autres vendeurs en %
const CHECK_INTERVAL = 30000; // Intervalle de vérification en millisecondes (30 secondes)
const CACHE_EXPIRY_TIME = 60 * 60 * 1000; // 1 heure (3600000 ms)

const productCache = new Map();

// Fonction pour ajouter un produit au cache (1 heure de cache)
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

  // Ajouter ici l'ID du canal logs
  const logsChannel = client.channels.cache.get('1285977835365994506'); // Remplace avec l'ID de ton canal "logs"

  // Si le canal des logs existe, enregistrer le démarrage
  if (logsChannel) {
    logsChannel.send(`Le bot a démarré et surveille maintenant les produits Amazon.`);
  }

  monitorAmazonProducts(logsChannel); // Surveillance des produits Amazon avec les logs
});

// Fonction pour surveiller les produits Amazon et détecter les autres vendeurs
async function monitorAmazonProducts(logsChannel) {
  try {
    while (true) {
      // Log la recherche Amazon
      if (logsChannel) {
        logsChannel.send(`Recherche de produits sur Amazon à partir de l'URL : ${AMAZON_URL}`);
      }

      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        }
      };

      const { data } = await axios.get(AMAZON_URL, options);
      const $ = cheerio.load(data);

      const products = [];
      const oneEuroProducts = [];
      const promoProducts = [];
      const edpProducts = [];
      const otherSellersProducts = [];

      $('.s-main-slot .s-result-item').each((i, element) => {
        const productTitle = $(element).find('h2 a span').text();
        const priceText = $(element).find('.a-price-whole').text();
        const priceUnitText = $(element).find('.a-price-whole').parent().text(); // Texte complet incluant prix au kilo
        const price = parseFloat(priceText.replace(',', '.'));
        const oldPriceText = $(element).find('.a-text-price .a-offscreen').first().text();
        const oldPrice = parseFloat(oldPriceText.replace(',', '.'));
        const productUrl = 'https://www.amazon.fr' + $(element).find('h2 a').attr('href');
        const productImage = $(element).find('img').attr('src');
        const otherSellersText = $(element).find('.a-color-base').text();

        // Exclure les prix au kilo, au litre, etc.
        if (priceUnitText.toLowerCase().includes("kilo") || priceUnitText.toLowerCase().includes("litre") || priceUnitText.toLowerCase().includes("kg") || priceUnitText.toLowerCase().includes("l")) {
          if (logsChannel) {
            logsChannel.send(`Produit ignoré : ${productTitle}, prix basé sur le poids ou le volume (${priceUnitText}).`);
          }
          return; // Ignore ce produit car c'est un prix au kilo ou au litre
        }

        // Vérification des frais de livraison
        let shippingCost = 0;
        const shippingText = $(element).find('.a-color-secondary .a-size-small').text();
        if (shippingText.toLowerCase().includes('livraison')) {
          const shippingCostText = shippingText.match(/(\d+,\d+)/);
          if (shippingCostText) {
            shippingCost = parseFloat(shippingCostText[0].replace(',', '.'));
          }
        }

        // Calcul du prix total avec livraison
        const totalPrice = price + shippingCost;

        if (totalPrice && oldPrice) {
          const discountPercentage = ((oldPrice - totalPrice) / oldPrice) * 100;

          // Ajout dans la liste des promos si la réduction dépasse 10%
          if (discountPercentage >= PROMO_THRESHOLD) {
            if (!isProductInCache(productUrl)) {
              promoProducts.push({ title: productTitle, price: totalPrice, oldPrice, discountPercentage, url: productUrl, image: productImage });
              addProductToCache(productUrl); // Ajoute le produit au cache

              if (logsChannel) {
                logsChannel.send(`Produit ajouté à la liste des promotions : ${productTitle}, Prix : ${totalPrice}€, Réduction : ${Math.round(discountPercentage)}%`);
              }
            } else if (logsChannel) {
              logsChannel.send(`Produit ${productTitle} déjà dans le cache, bloqué pour éviter le spam.`);
            }
          }

          // Vérification pour les produits à moins de 2 €
          if (totalPrice <= PRICE_THRESHOLD && discountPercentage >= DISCOUNT_THRESHOLD) {
            if (!isProductInCache(productUrl)) {
              products.push({ title: productTitle, price: totalPrice, oldPrice, discountPercentage, url: productUrl, image: productImage });
              addProductToCache(productUrl); // Ajoute au cache

              if (logsChannel) {
                logsChannel.send(`Produit à moins de 2 € détecté : ${productTitle}, Prix : ${totalPrice}€.`);
              }
            } else if (logsChannel) {
              logsChannel.send(`Produit ${productTitle} déjà dans le cache, bloqué pour éviter le spam.`);
            }
          }

          // Vérification pour les produits à 1 € ou moins
          if (totalPrice <= PRICE_THRESHOLD_1_EURO) {
            if (!isProductInCache(productUrl)) {
              oneEuroProducts.push({ title: productTitle, price: totalPrice, oldPrice, discountPercentage, url: productUrl, image: productImage });
              addProductToCache(productUrl); // Ajoute au cache

              if (logsChannel) {
                logsChannel.send(`Produit à moins de 1 € détecté : ${productTitle}, Prix : ${totalPrice}€.`);
              }
            } else if (logsChannel) {
              logsChannel.send(`Produit ${productTitle} déjà dans le cache, bloqué pour éviter le spam.`);
            }
          }

          // Vérification pour les erreurs de prix (EDP)
          if (discountPercentage >= EDP_THRESHOLD) {
            if (!isProductInCache(productUrl)) {
              edpProducts.push({ title: productTitle, price: totalPrice, oldPrice, discountPercentage, url: productUrl, image: productImage });
              addProductToCache(productUrl); // Ajoute au cache

              if (logsChannel) {
                logsChannel.send(`Erreur de prix détectée : ${productTitle}, Prix : ${totalPrice}€, Réduction : ${Math.round(discountPercentage)}%`);
              }
            } else if (logsChannel) {
              logsChannel.send(`Produit ${productTitle} déjà dans le cache, bloqué pour éviter le spam.`);
            }
          }

          // Détection des autres vendeurs
          if (otherSellersText.toLowerCase().includes('autres vendeurs')) {
            const otherSellersUrl = productUrl + '#other-sellers'; // Lien vers la section des autres vendeurs
            otherSellersProducts.push({ title: productTitle, price: totalPrice, url: productUrl, image: productImage, otherSellersUrl });

            if (logsChannel) {
              logsChannel.send(`Produit avec des "autres vendeurs" détecté : ${productTitle}, URL : ${otherSellersUrl}`);
            }
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
  const promoChannel = client.channels.cache.get('1285969661535453215'); // Canal des promotions
  const oneEuroChannel = client.channels.cache.get('1285939619598172232'); // Canal des produits à 1 €
  const edpChannel = client.channels.cache.get('1285953900066902057'); // Canal des erreurs de prix
  const productsChannel = client.channels.cache.get('1285927841577439232'); // Canal des produits à moins de 2 €

  // Envoi des produits à moins de 2 €
  products.forEach((product) => sendEmbed(productsChannel, product, 'Produit en promotion'));

  // Envoi des produits à 1 € ou moins
  oneEuroProducts.forEach((product) => sendEmbed(oneEuroChannel, product, 'Produit à 1 € ou moins'));

  // Envoi des produits en promo
  promoProducts.forEach((product) => sendEmbed(promoChannel, product, 'Produit en promotion'));

  // Envoi des produits avec erreur de prix
  edpProducts.forEach((product) => sendEmbed(edpChannel, product, 'Erreur de prix détectée'));
}

// Fonction pour envoyer un embed dans un canal
function sendEmbed(channel, product, description) {
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

    channel.send({ embeds: [embed] });
  }
}

const token = process.env.TOKEN;

client.login(token);