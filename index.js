// Utiliser dotenv pour charger les variables d'environnement (important si non déployé sur une plateforme avec des variables d'environnement configurées)
try { require('dotenv').config(); } catch (e) {}

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
// TRÈS IMPORTANT pour Render : Utiliser le port fourni par l'environnement
// Si process.env.PORT n'est pas disponible (en local), utiliser 3000 par défaut.
const port = process.env.PORT || 3000; 

// Middleware pour analyser le JSON entrant
app.use(express.json());

// NOUVEAU: Ajout d'une route racine pour le diagnostic (si Render essaie d'accéder à /)
app.get('/', (req, res) => {
    res.status(200).send("Dave-Bot est actif et écoute les webhooks sur /webhook. Version de l'API Cloud utilisée: v19.0.");
});

// Initialisation de Gemini
if (!GEMINI_API_KEY || GEMINI_API_KEY === 'VOTRE_GEMINI_API_KEY') {
    logger.warn("La clé API Gemini n'est pas configurée ou est le placeholder. Le mode AI ne fonctionnera pas.");
}
// Note: GoogleGenAI accepte une clé non valide mais l'erreur se produit seulement lors de l'appel.
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
        logger.info(`Message de réponse envoyé avec succès à: ${to}`); 
    } catch (error) {
        // Log détaillé pour capturer l'erreur 401/400 et le message Meta
        logger.error(`Erreur d'envoi de message WhatsApp (Code ${error.response ? error.response.status : 'N/A'}): ${error.message}`);
        if (error.response && error.response.data) {
             logger.error("Détails de l'erreur Meta:", JSON.stringify(error.response.data));
        }
    }
}

// --- Logique de Traitement des Messages (Commandes et AI) ---
async function handleIncomingMessage(message) {
    const from = message.from;
    const messageText = message.text.body;

    logger.info(`Message reçu de ${from}: ${messageText}`); 

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
                await sendWhatsAppMessage(from, "Redémarrage du serveur...");
                process.exit(0); // Quitte le processus, Render le redémarrera.
                break;
            default:
                await sendWhatsAppMessage(from, `Commande non reconnue: *${BOT_PREFIX}${command}*`);
                break;
        }
    }
    // 2. GESTION DES MESSAGES NON-COMMANDES (Gemini AI)
    // On vérifie que la clé est présente ET n'est pas le placeholder
    else if (GEMINI_API_KEY && GEMINI_API_KEY !== 'VOTRE_GEMINI_API_KEY') { 
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
        // Message d'erreur clair si Gemini n'est pas prêt
        await sendWhatsAppMessage(from, "Je suis Dave-Bot. Mon assistant AI (Gemini) n'est pas configuré. Veuillez mettre à jour la clé API.");
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
    } catch (error) {
        // Log l'erreur mais ne bloque pas le démarrage du serveur
        logger.error('Impossible de se connecter à la base de données (SQLite/Postgres):', error.message); 
    }

    app.listen(port, () => {
        // Message de log CRITIQUE que Render recherche
        logger.info(`Dave-Bot est démarré et écoute sur le port ${port}.`);
    });
}

startServer();

