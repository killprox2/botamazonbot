const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
});

client.login(process.env.TOKEN);

// Rôles et salons
const roles = {
    owner: 'OwnerRoleID',
    modo: 'ModoRoleID',
    preniumPlus: 'PreniumPlusRoleID',
    prenium: 'PreniumRoleID',
    visiteur: 'VisiteurRoleID',
};

const channels = {
    amazon: '1255863140974071893',
    cdiscount: '1285939619598172232',
    auchan: '1285969661535453215',
    manomano: '1285953900066902057',
    electromenager: 'ElectromenagerChannelID',
    livre: 'LivreChannelID',
    enfant: 'EnfantChannelID',
    jouet: 'JouetChannelID',
    entretien: 'EntretienChannelID',
    electronique: 'ElectroniqueChannelID',
    deal: '1285955371252580352',
    logs: '1285977835365994506', // ID du salon où les logs seront envoyés
};

// Fonction pour envoyer des messages dans le salon de logs
function sendLogMessage(content) {
    const logChannel = client.channels.cache.get(channels.logs);
    if (logChannel) {
        logChannel.send(content);
    } else {
        console.log('Salon de logs introuvable.');
    }
}

// Logs au démarrage du bot
client.once('ready', () => {
    console.log('Bot is online!');
    sendLogMessage('✅ Bot démarré et prêt à l\'emploi.');
});

// Commande *updaterole*
client.on('messageCreate', async (message) => {
    if (message.content.startsWith('*updaterole')) {
        const [command, username, roleName] = message.content.split(' ');
        const member = message.guild.members.cache.find(m => m.user.username === username);
        const role = message.guild.roles.cache.find(r => r.name === roleName);

        if (member && role) {
            await member.roles.add(role);
            message.channel.send(`${username} a reçu le rôle ${roleName}.`);
            sendLogMessage(`🔄 Rôle mis à jour : ${username} a reçu le rôle ${roleName}.`);
        } else {
            message.channel.send("Utilisateur ou rôle introuvable.");
            sendLogMessage('❌ Mise à jour du rôle échouée, utilisateur ou rôle introuvable.');
        }
    }
});

// Commande *ban*
client.on('messageCreate', async (message) => {
    if (message.content.startsWith('*ban')) {
        const [command, username] = message.content.split(' ');
        const member = message.guild.members.cache.find(m => m.user.username === username);

        if (member) {
            await member.ban();
            message.channel.send(`${username} a été banni.`);
            sendLogMessage(`🔨 Utilisateur banni : ${username} par ${message.author.username}`);
        } else {
            message.channel.send("Utilisateur introuvable.");
            sendLogMessage(`❌ Tentative de ban échouée pour ${username}`);
        }
    }
});

// Commande *mute*
client.on('messageCreate', async (message) => {
    if (message.content.startsWith('*mute')) {
        const [command, username, duration] = message.content.split(' ');
        const member = message.guild.members.cache.find(m => m.user.username === username);

        if (member) {
            const mutedRole = message.guild.roles.cache.find(r => r.name === 'Muted');
            await member.roles.add(mutedRole);
            message.channel.send(`${username} est mute pour ${duration}.`);
            sendLogMessage(`🔇 Utilisateur mute : ${username} pour ${duration}`);
        } else {
            message.channel.send("Utilisateur introuvable.");
            sendLogMessage(`❌ Tentative de mute échouée pour ${username}`);
        }
    }
});

// Commande *bloque*
client.on('messageCreate', async (message) => {
    if (message.content.startsWith('*bloque')) {
        const [command, username] = message.content.split(' ');
        const member = message.guild.members.cache.find(m => m.user.username === username);

        if (member) {
            // Logique pour bloquer les salons
            message.channel.send(`${username} ne voit que le salon en attente.`);
            sendLogMessage(`🔒 Accès bloqué pour ${username}, seul le salon en attente est visible.`);
        } else {
            message.channel.send("Utilisateur introuvable.");
            sendLogMessage(`❌ Tentative de blocage échouée pour ${username}`);
        }
    }
});

// Commande *addmonitor* pour ajouter un produit spécial à surveiller
client.on('messageCreate', async (message) => {
    if (message.content.startsWith('*addmonitor')) {
        const [command, productLink, maxPrice] = message.content.split(' ');
        // Stocker le produit à suivre (ici JSON ou DB)
        message.channel.send(`Le produit ${productLink} sera suivi avec un prix maximum de ${maxPrice}€.`);
        sendLogMessage(`🔍 Produit ajouté pour suivi : ${productLink} avec un prix maximum de ${maxPrice}€.`);
    }
});

// Fonction de scraping Amazon
async function checkAmazonDeals() {
    try {
        sendLogMessage('🔎 Recherche de deals Amazon...');
        const response = await axios.get('https://www.amazon.fr/deals');
        const deals = parseAmazonDeals(response.data); // Fonction pour parser les données

        if (deals.length > 0) {
            sendLogMessage(`📦 ${deals.length} deals trouvés sur Amazon.`);
        } else {
            sendLogMessage('❌ Aucun deal trouvé sur Amazon.');
        }

        deals.forEach(deal => {
            const embed = new EmbedBuilder()
                .setTitle(deal.title)
                .setURL(deal.url)
                .addFields(
                    { name: 'Prix actuel', value: deal.currentPrice, inline: true },
                    { name: 'Prix avant', value: deal.oldPrice, inline: true },
                    { name: 'Réduction', value: `${deal.discount}%`, inline: true }
                )
                .setFooter({ text: 'Amazon Deal' });

            client.channels.cache.get(channels.amazon).send({ embeds: [embed] });
            sendLogMessage(`📌 Produit ajouté : ${deal.title} - ${deal.currentPrice}€ (réduction de ${deal.discount}%)`);
        });
    } catch (error) {
        sendLogMessage('⚠️ Erreur lors de la recherche des deals Amazon.');
        console.error('Erreur lors de la recherche des deals Amazon:', error);
    }
}

// Fonction de scraping Cdiscount
async function checkCdiscountDeals() {
    try {
        sendLogMessage('🔎 Recherche de deals Cdiscount...');
        const response = await axios.get('https://www.cdiscount.com/');
        const deals = parseCdiscountDeals(response.data); // Fonction pour parser les données

        if (deals.length > 0) {
            sendLogMessage(`📦 ${deals.length} deals trouvés sur Cdiscount.`);
        } else {
            sendLogMessage('❌ Aucun deal trouvé sur Cdiscount.');
        }

        deals.forEach(deal => {
            const embed = new EmbedBuilder()
                .setTitle(deal.title)
                .setURL(deal.url)
                .addFields(
                    { name: 'Prix actuel', value: deal.currentPrice, inline: true },
                    { name: 'Prix avant', value: deal.oldPrice, inline: true },
                    { name: 'Réduction', value: `${deal.discount}%`, inline: true }
                )
                .setFooter({ text: 'Cdiscount Deal' });

            client.channels.cache.get(channels.cdiscount).send({ embeds: [embed] });
            sendLogMessage(`📌 Produit ajouté : ${deal.title} - ${deal.currentPrice}€ (réduction de ${deal.discount}%)`);
        });
    } catch (error) {
        sendLogMessage('⚠️ Erreur lors de la recherche des deals Cdiscount.');
        console.error('Erreur lors de la recherche des deals Cdiscount:', error);
    }
}

// Fonction de scraping Auchan
async function checkAuchanDeals() {
    try {
        sendLogMessage('🔎 Recherche de deals Auchan...');
        const response = await axios.get('https://www.auchan.fr/');
        const deals = parseAuchanDeals(response.data); // Fonction pour parser les données

        if (deals.length > 0) {
            sendLogMessage(`📦 ${deals.length} deals trouvés sur Auchan.`);
        } else {
            sendLogMessage('❌ Aucun deal trouvé sur Auchan.');
        }

        deals.forEach(deal => {
            const embed = new EmbedBuilder()
                .setTitle(deal.title)
                .setURL(deal.url)
                .addFields(
                    { name: 'Prix actuel', value: deal.currentPrice, inline: true },
                    { name: 'Prix avant', value: deal.oldPrice, inline: true },
                    { name: 'Réduction', value: `${deal.discount}%`, inline: true }
                )
                .setFooter({ text: 'Auchan Deal' });

            client.channels.cache.get(channels.auchan).send({ embeds: [embed] });
            sendLogMessage(`📌 Produit ajouté : ${deal.title} - ${deal.currentPrice}€ (réduction de ${deal.discount}%)`);
        });
    } catch (error) {
        sendLogMessage('⚠️ Erreur lors de la recherche des deals Auchan.');
        console.error('Erreur lors de la recherche des deals Auchan:', error);
    }
}

// Fonction de scraping Manomano
async function checkManomanoDeals() {
    try {
        sendLogMessage('🔎 Recherche de deals Manomano...');
        const response = await axios.get('https://www.manomano.fr/');
        const deals = parseManomanoDeals(response.data); // Fonction pour parser les données

        if (deals.length > 0) {
            sendLogMessage(`📦 ${deals.length} deals trouvés sur Manomano.`);
        } else {
            sendLogMessage('❌ Aucun deal trouvé sur Manomano.');
        }

        deals.forEach(deal => {
            const embed = new EmbedBuilder()
                .setTitle(deal.title)
                .setURL(deal.url)
                .addFields(
                    { name: 'Prix actuel', value: deal.currentPrice, inline: true },
                    { name: 'Prix avant', value: deal.oldPrice, inline: true },
                    { name: 'Réduction', value: `${deal.discount}%`, inline: true }
                )
                .setFooter({ text: 'Manomano Deal' });

            client.channels.cache.get(channels.manomano).send({ embeds: [embed] });
            sendLogMessage(`📌 Produit ajouté : ${deal.title} - ${deal.currentPrice}€ (réduction de ${deal.discount}%)`);
        });
    } catch (error) {
        sendLogMessage('⚠️ Erreur lors de la recherche des deals Manomano.');
        console.error('Erreur lors de la recherche des deals Manomano:', error);
    }
}

// Planification des recherches (exécute toutes les heures)
setInterval(() => {
    sendLogMessage('🔄 Lancement de la recherche de deals Amazon...');
    checkAmazonDeals();
}, 3600000); // Toutes les heures

setInterval(() => {
    sendLogMessage('🔄 Lancement de la recherche de deals Cdiscount...');
    checkCdiscountDeals();
}, 3600000); // Toutes les heures

setInterval(() => {
    sendLogMessage('🔄 Lancement de la recherche de deals Auchan...');
    checkAuchanDeals();
}, 3600000); // Toutes les heures

setInterval(() => {
    sendLogMessage('🔄 Lancement de la recherche de deals Manomano...');
    checkManomanoDeals();
}, 3600000); // Toutes les heures


