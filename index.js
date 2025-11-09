// index.js

const express = require('express');
const app = express();
const axios = require('axios'); // Pour envoyer des réponses
const { GoogleGenAI } = require('@google/genai'); // 1. NOUVEAU: Importation du SDK Gemini

// Port sur lequel le serveur doit écouter (nécessaire pour Render/Docker)
const PORT = process.env.PORT || 3000;

// Tokens et IDs du bot
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN; 
const WA_ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_ID;

// 2. NOUVEAU: Token Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY }); // Initialisation de l'IA

// Middleware pour analyser les requêtes JSON (crucial pour le POST)
app.use(express.json());

// ------------------------------------------------------------------
// A. ENDPOINT POUR LA VÉRIFICATION DU WEBHOOK (MÉTHODE GET)
// ------------------------------------------------------------------
app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    // Vérification du mode et du jeton
    if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
        // Succès : Renvoyer le challenge (clé unique) à Meta avec statut 200
        console.log('Webhook Verified!');
        res.status(200).send(challenge);
    } else {
        // Échec : Jeton incorrect ou mode invalide
        console.error('Webhook Verification Failed!');
        res.sendStatus(403);
    }
});

// ------------------------------------------------------------------
// B. ENDPOINT POUR LA RÉCEPTION DES MESSAGES (MÉTHODE POST)
// ------------------------------------------------------------------
app.post('/webhook', (req, res) => {
    // Renvoyer le statut 200 (OK) immédiatement pour éviter les timeouts
    res.sendStatus(200); 

    let body = req.body;

    if (body.object === 'whatsapp_business_account') {
        body.entry.forEach(entry => {
            entry.changes.forEach(change => {
                if (change.value.messages) {
                    // IMPORTANT: Ajout de 'async' ici pour pouvoir utiliser 'await' avec l'IA
                    change.value.messages.forEach(async message => {
                        const userText = message.text.body;
                        const userFrom = message.from; // Numéro de l'utilisateur

                        console.log(`Message reçu de ${userFrom}: ${userText}`);
                        
                        // 3. NOUVEAU: Appel à la logique de commande/IA
                        const responseText = await getBotResponse(userText);
                        
                        if (responseText) {
                            sendWhatsAppMessage(userFrom, responseText);
                        }
                    });
                }
            });
        });
    }
});

// ------------------------------------------------------------------
// C. NOUVEAU: FONCTION DE GESTION DES COMMANDES ET DE L'IA
// ------------------------------------------------------------------
async function getBotResponse(userText) {
    const PREFIX = '.'; // Préfixe pour les commandes (ex: .tagall)
    
    // Traitement des commandes classiques (pour le chat individuel)
    if (userText.startsWith(PREFIX)) {
        const command = userText.split(' ')[0].toLowerCase();
        
        // --- LOGIQUE DE COMMANDE ---
        if (command === '.aide' || command === '.help') {
            return "Je peux répondre à vos questions grâce à l'IA (Gemini) ou exécuter des commandes simples:\n.aide (affiche cette liste)\n.status (vérifie mon état)";
        } else if (command === '.status') {
            return "Je suis en ligne et mon IA est opérationnelle!";
        } else if (command === '.tagall') {
            // Note: Comme discuté, les commandes de groupe ne fonctionnent pas avec l'API Cloud.
            return "Désolé, la commande .tagall est pour les interactions de groupe, ce qui n'est pas supporté par l'API Cloud officielle de WhatsApp.";
        } else {
            // Commande non reconnue
            return `Commande "${command}" non reconnue. Envoyez .aide pour la liste des commandes.`;
        }

    } else {
        // --- LOGIQUE IA (GEMINI) ---
        if (!GEMINI_API_KEY) {
            console.error('Gemini API Key is missing. Cannot use AI.');
            return "Désolé, la clé d'API de l'IA est manquante. Je ne peux pas répondre à votre question. Veuillez vérifier la variable GEMINI_API_KEY.";
        }
        
        try {
            console.log(`Envoi du prompt à Gemini: ${userText}`);
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash', // Modèle rapide pour le chat
                contents: userText,
            });
            return response.text.trim();
        } catch (error) {
            console.error('Erreur lors de l\'appel à Gemini:', error.message);
            // Retourne un message d'erreur plus convivial à l'utilisateur
            return "Désolé, une erreur est survenue lors du traitement de votre demande par l'IA. Veuillez réessayer plus tard.";
        }
    }
}


// ------------------------------------------------------------------
// D. FONCTION D'ENVOI DE RÉPONSE (Utilise le WA_ACCESS_TOKEN)
// ------------------------------------------------------------------
function sendWhatsAppMessage(to, text) {
    if (!WA_ACCESS_TOKEN || !WA_PHONE_ID) {
        console.error('Tokens or Phone ID are missing. Cannot send message.');
        return;
    }
    // S'assurer que le texte est une chaîne non vide
    if (!text || typeof text !== 'string') return; 

    const url = `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`;
    
    axios.post(url, {
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
    })
    .then(response => console.log('Message envoyé avec succès:', response.data))
    .catch(error => console.error('Erreur lors de l\'envoi:', error.response ? error.response.data : error.message));
}

// ------------------------------------------------------------------
// DÉMARRAGE DU SERVEUR
// ------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

