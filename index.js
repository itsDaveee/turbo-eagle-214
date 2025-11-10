const express = require('express');
const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
const {
    WA_ACCESS_TOKEN,
    WA_PHONE_ID,
    WA_VERIFY_TOKEN,
    GEMINI_API_KEY,
    BOT_PREFIX,
    logger,
    sequelize
} = require('./config');

const app = express();
const port = process.env.PORT || 3000;

// Middleware pour analyser le JSON entrant
app.use(express.json());

// Initialisation de Gemini
if (!GEMINI_API_KEY || GEMINI_API_KEY === "VOTRE_GEMINI_API_KEY") {
    logger.error("La clé API Gemini n'est pas configurée. Le mode AI ne fonctionnera pas.");
}
const gemini = new GoogleGenAI(GEMINI_API_KEY);

// --- Fonctions d'API Cloud WhatsApp ---
async function sendWhatsAppMessage(to, text) {
    if (!WA_ACCESS_TOKEN || !WA_PHONE_ID) {
        logger.error("WA_ACCESS_TOKEN ou WA_PHONE_ID non configurés.");
        return;
    }
    const url = `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`;
    try {
        await axios.post(url, {
            messaging_product: "whatsapp",
            to: to,
            type: "text",
            text: {
                body: text
            }
        }, {
            headers: {
                'Authorization': `Bearer ${WA_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        logger.error(`Erreur d'envoi de message WhatsApp: ${error.message}`);
    }
}

// --- Logique de Traitement des Messages (Commandes et AI) ---
async function handleIncomingMessage(message) {
    const from = message.from;
    const messageText = message.text.body;

    // 1. GESTION DES COMMANDES (.list, .ping, etc.)
    if (messageText.startsWith(BOT_PREFIX)) {
        const command = messageText.slice(BOT_PREFIX.length).trim().split(' ')[0].toLowerCase();

        switch (command) {
            case 'ping':
                await sendWhatsAppMessage(from, `Pong ! 🤖 (Latency simulated)`);
                break;
            case 'list':
                const listMsg = `*Dave-Bot Commandes Disponibles:*\n\n${BOT_PREFIX}ping - Vérifie la connexion.\n${BOT_PREFIX}list - Affiche cette liste.\n\n_Tout autre message sera traité par Gemini AI._`;
                await sendWhatsAppMessage(from, listMsg);
                break;
            case 'restart':
                // Les commandes 'restart' et 'shutdown' doivent être gérées
                // en fonction de votre logique de permissions (sudo).
                // Pour l'API Cloud, elles ne redémarrent que le serveur web.
                await sendWhatsAppMessage(from, "Redémarrage du serveur...");
                process.exit(0); // Quitte le processus, PM2 ou Render le redémarrera.
                break;
            default:
                await sendWhatsAppMessage(from, `Commande non reconnue: *${BOT_PREFIX}${command}*`);
                break;
        }
    }
    // 2. GESTION DES MESSAGES NON-COMMANDES (Gemini AI)
    else if (GEMINI_API_KEY && GEMINI_API_KEY !== "VOTRE_GEMINI_API_KEY") {
        try {
            const response = await gemini.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: messageText,
            });
            await sendWhatsAppMessage(from, response.text);
        } catch (error) {
            logger.error(`Erreur Gemini AI: ${error.message}`);
            await sendWhatsAppMessage(from, "Désolé, une erreur est survenue lors de la communication avec l'assistant Gemini.");
        }
    } else {
        await sendWhatsAppMessage(from, "Je suis Dave-Bot. Pour parler à l'AI, configurez la clé Gemini. Utilisez *.list* pour les commandes.");
    }
}

// --- Routes Express ---

// 1. ROUTE DE VÉRIFICATION DU WEBHOOK (obligatoire pour Meta)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
            logger.info('WEBHOOK_VERIFIED');
            return res.status(200).send(challenge);
        }
    }
    res.sendStatus(403);
});

// 2. ROUTE DE RÉCEPTION DES MESSAGES (Webhook)
app.post('/webhook', (req, res) => {
    const body = req.body;
    
    // S'assurer que la requête vient bien de l'API WhatsApp
    if (body.object === 'whatsapp_business_account') {
        body.entry.forEach(entry => {
            entry.changes.forEach(change => {
                if (change.field === 'messages') {
                    const message = change.value.messages?.[0];
                    if (message && message.type === 'text') {
                        // Traiter le message entrant
                        handleIncomingMessage(message);
                    }
                }
            });
        });
        res.sendStatus(200); // Renvoyer un 200 OK rapidement
    } else {
        res.sendStatus(404);
    }
});

// --- Démarrage du serveur ---
async function startServer() {
    // Initialisation de la base de données (si nécessaire)
    try {
        await sequelize.authenticate();
        logger.info('Connexion à la base de données établie avec succès.');
        // Si vous avez des modèles Sequelize, vous devriez les synchroniser ici (ex: sequelize.sync()).
    } catch (error) {
        logger.error('Impossible de se connecter à la base de données:', error);
    }

    app.listen(port, () => {
        logger.info(`Dave-Bot est démarré et écoute sur le port ${port}.`);
    });
}

startServer();
